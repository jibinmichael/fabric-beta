package main

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

var hopByHopHeaders = map[string]bool{
	"Connection":          true,
	"Proxy-Connection":    true,
	"Keep-Alive":          true,
	"Proxy-Authenticate":  true,
	"Proxy-Authorization": true,
	"Te":                  true,
	"Trailer":             true,
	"Transfer-Encoding":   true,
	"Upgrade":             true,
}

func copyHeaders(dst http.Header, src http.Header) {
	for key, values := range src {
		if hopByHopHeaders[http.CanonicalHeaderKey(key)] {
			continue
		}
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func writePreviewStartupHTML(w http.ResponseWriter, status string) {
	message := "Preview server starting..."
	if status != "" {
		message = status
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusServiceUnavailable)
	_, _ = w.Write([]byte(fmt.Sprintf(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="refresh" content="1.2" />
  <title>Preview Starting</title>
  <style>
    html, body {
      margin: 0; height: 100%%; width: 100%%;
      display: flex; align-items: center; justify-content: center;
      font-family: "Avenir Next", "Avenir", -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
      font-size: 14px; color: #666; background: #fff;
    }
  </style>
</head>
<body>%s</body>
</html>`, message)))
}

func previewProxyMiddleware(app *App) assetserver.Middleware {
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Same-origin iframe uses /preview/...; Vite is built with base: '/preview/' — forward path unchanged.
			isPreview := r.URL.Path == "/preview" || strings.HasPrefix(r.URL.Path, "/preview/")
			if !isPreview {
				next.ServeHTTP(w, r)
				return
			}

			port := app.GetPreviewPort()
			if port == 0 {
				writePreviewStartupHTML(w, app.GetPreviewStatus())
				return
			}

			targetPath := r.URL.Path
			if targetPath == "/preview" {
				targetPath = "/preview/"
			}

			targetURL := &url.URL{
				Scheme:   "http",
				Host:     fmt.Sprintf("127.0.0.1:%d", port),
				Path:     targetPath,
				RawQuery: r.URL.RawQuery,
			}

			proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL.String(), r.Body)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}

			copyHeaders(proxyReq.Header, r.Header)
			proxyReq.Host = targetURL.Host

			resp, err := client.Do(proxyReq)
			if err != nil {
				http.Error(w, "Preview proxy error: "+err.Error(), http.StatusBadGateway)
				return
			}
			defer resp.Body.Close()

			copyHeaders(w.Header(), resp.Header)
			w.WriteHeader(resp.StatusCode)
			_, _ = io.Copy(w, resp.Body)
		})
	}
}
