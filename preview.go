package main

import (
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed build/preview-server-template/**
var previewTemplateFS embed.FS

const (
	previewTemplateRoot = "build/preview-server-template"
	templateVersionFile = ".template-version"
)

var preserveTemplateFiles = map[string]bool{
	"src/Generated.tsx": true,
	"src/mockData.ts":   true,
}

type processKiller interface {
	ProcessID() int
	Signal(sig os.Signal) error
	Kill() error
	Wait() error
}

type cmdProcess struct {
	cmd *exec.Cmd
}

func (p *cmdProcess) ProcessID() int {
	if p.cmd.Process == nil {
		return 0
	}
	return p.cmd.Process.Pid
}

func (p *cmdProcess) Signal(sig os.Signal) error {
	if p.cmd.Process == nil {
		return nil
	}
	return p.cmd.Process.Signal(sig)
}

func (p *cmdProcess) Kill() error {
	if p.cmd.Process == nil {
		return nil
	}
	return p.cmd.Process.Kill()
}

func (p *cmdProcess) Wait() error {
	return p.cmd.Wait()
}

func (a *App) appDataDir() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDir, "Fabric"), nil
}

func (a *App) previewServerDir() (string, error) {
	base, err := a.appDataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "preview-server"), nil
}

func (a *App) previewTemplateVersion() (string, error) {
	data, err := fs.ReadFile(previewTemplateFS, filepath.Join(previewTemplateRoot, templateVersionFile))
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

func (a *App) readDiskTemplateVersion(targetDir string) (string, error) {
	data, err := os.ReadFile(filepath.Join(targetDir, templateVersionFile))
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

func (a *App) copyTemplateToDisk(targetDir string, preserveGenerated bool) error {
	return fs.WalkDir(previewTemplateFS, previewTemplateRoot, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == previewTemplateRoot {
			return nil
		}

		relPath, err := filepath.Rel(previewTemplateRoot, path)
		if err != nil {
			return err
		}
		relPath = filepath.ToSlash(relPath)
		destPath := filepath.Join(targetDir, relPath)

		if d.IsDir() {
			return os.MkdirAll(destPath, 0o755)
		}

		if preserveGenerated && preserveTemplateFiles[relPath] {
			if _, err := os.Stat(destPath); err == nil {
				return nil
			}
		}

		if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
			return err
		}

		content, err := fs.ReadFile(previewTemplateFS, path)
		if err != nil {
			return err
		}
		return os.WriteFile(destPath, content, 0o644)
	})
}

func (a *App) ensureTemplateVersioned(targetDir string) error {
	embeddedVersion, err := a.previewTemplateVersion()
	if err != nil {
		return err
	}

	if _, err := os.Stat(targetDir); os.IsNotExist(err) {
		a.setPreviewStatus("copying-template")
		return a.copyTemplateToDisk(targetDir, false)
	} else if err != nil {
		return err
	}

	currentVersion, err := a.readDiskTemplateVersion(targetDir)
	needsUpdate := err != nil || strings.TrimSpace(currentVersion) != embeddedVersion
	if !needsUpdate {
		return nil
	}

	a.setPreviewStatus("copying-template")
	return a.copyTemplateToDisk(targetDir, true)
}

func withNodePaths(baseEnv []string) []string {
	const pathPrefix = "/opt/homebrew/bin:/opt/homebrew/opt/node@22/bin:/usr/local/bin:"
	out := make([]string, 0, len(baseEnv))
	hasPath := false
	for _, entry := range baseEnv {
		if strings.HasPrefix(entry, "PATH=") {
			hasPath = true
			out = append(out, "PATH="+pathPrefix+strings.TrimPrefix(entry, "PATH="))
			continue
		}
		out = append(out, entry)
	}
	if !hasPath {
		out = append(out, "PATH="+pathPrefix+os.Getenv("PATH"))
	}
	return out
}

func pathFromEnv(env []string) string {
	for _, entry := range env {
		if strings.HasPrefix(entry, "PATH=") {
			return strings.TrimPrefix(entry, "PATH=")
		}
	}
	return os.Getenv("PATH")
}

func ensureNodeBinary(env []string) error {
	originalPath := os.Getenv("PATH")
	_ = os.Setenv("PATH", pathFromEnv(env))
	defer func() {
		_ = os.Setenv("PATH", originalPath)
	}()

	if _, err := exec.LookPath("node"); err != nil {
		return errors.New("Node.js not found — install Node 22 from nodejs.org")
	}

	return nil
}

func (a *App) runCommand(dir string, env []string, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Env = env
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s failed: %w\n%s", name, strings.Join(args, " "), err, string(output))
	}
	return nil
}

func processExists(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

func killPIDGracefully(pid int) {
	if pid <= 0 || !processExists(pid) {
		return
	}

	if runtime.GOOS == "windows" {
		_ = syscall.Kill(pid, syscall.SIGKILL)
		return
	}

	_ = syscall.Kill(pid, syscall.SIGTERM)
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if !processExists(pid) {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	_ = syscall.Kill(pid, syscall.SIGKILL)
}

func killProcessGracefully(proc processKiller) {
	if proc == nil {
		return
	}
	killPIDGracefully(proc.ProcessID())
	_ = proc.Wait()
}

func (a *App) killPreviewStragglers(targetDir string) {
	output, err := exec.Command("ps", "-axo", "pid=,command=").Output()
	if err != nil {
		return
	}

	lines := strings.Split(string(output), "\n")
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}

		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		pid, err := strconv.Atoi(parts[0])
		if err != nil || pid <= 0 || pid == os.Getpid() {
			continue
		}

		command := strings.Join(parts[1:], " ")
		if strings.Contains(command, targetDir) && strings.Contains(command, "node") && strings.Contains(command, "vite") {
			println("Killing preview straggler PID:", pid)
			killPIDGracefully(pid)
		}
	}
}

func (a *App) startPreviewServerOnPort(targetDir string, env []string, port int) (processKiller, error) {
	cmd := exec.Command(
		"npm",
		"run",
		"dev",
		"--",
		"--host",
		"127.0.0.1",
		"--port",
		strconv.Itoa(port),
		"--strictPort",
		"true",
	)
	cmd.Dir = targetDir
	cmd.Env = env
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	proc := &cmdProcess{cmd: cmd}
	client := &http.Client{Timeout: 300 * time.Millisecond}
	url := fmt.Sprintf("http://127.0.0.1:%d", port)
	deadline := time.Now().Add(2500 * time.Millisecond)
	for time.Now().Before(deadline) {
		resp, err := client.Get(url)
		if err == nil {
			_ = resp.Body.Close()
			return proc, nil
		}
		time.Sleep(150 * time.Millisecond)
	}

	killProcessGracefully(proc)
	return nil, fmt.Errorf("preview server did not start on port %d", port)
}

func (a *App) EnsurePreviewServer() (int, error) {
	a.previewMu.Lock()
	if a.previewPort > 0 && a.previewCmd != nil {
		port := a.previewPort
		a.previewMu.Unlock()
		return port, nil
	}
	if a.previewStarting {
		port := a.previewPort
		a.previewMu.Unlock()
		return port, nil
	}
	a.previewStarting = true
	a.previewStatus = ""
	a.previewMu.Unlock()

	resetStarting := func() {
		a.previewMu.Lock()
		a.previewStarting = false
		a.previewMu.Unlock()
	}
	defer resetStarting()

	targetDir, err := a.previewServerDir()
	if err != nil {
		a.setPreviewStatus("error: " + err.Error())
		return 0, err
	}

	if err := a.ensureTemplateVersioned(targetDir); err != nil {
		a.setPreviewStatus("error: " + err.Error())
		return 0, err
	}

	previewEnv := withNodePaths(os.Environ())
	if err := ensureNodeBinary(previewEnv); err != nil {
		a.setPreviewStatus("error: " + err.Error())
		return 0, err
	}

	if _, err := os.Stat(filepath.Join(targetDir, "node_modules")); os.IsNotExist(err) {
		a.setPreviewStatus("installing-dependencies")
		if err := a.runCommand(targetDir, previewEnv, "npm", "install"); err != nil {
			a.setPreviewStatus("error: " + err.Error())
			return 0, err
		}
	} else if err != nil {
		a.setPreviewStatus("error: " + err.Error())
		return 0, err
	}

	a.previewMu.Lock()
	currentProc := a.previewCmd
	a.previewCmd = nil
	a.previewPort = 0
	a.previewMu.Unlock()
	killProcessGracefully(currentProc)

	a.killPreviewStragglers(targetDir)

	a.setPreviewStatus("starting-vite")
	var lastErr error
	for port := 5175; port <= 5199; port++ {
		proc, err := a.startPreviewServerOnPort(targetDir, previewEnv, port)
		if err == nil {
			a.previewMu.Lock()
			a.previewPort = port
			a.previewCmd = proc
			a.previewStatus = "ready"
			a.previewMu.Unlock()
			return port, nil
		}
		lastErr = err
	}

	if lastErr == nil {
		lastErr = errors.New("unable to start preview server on ports 5175-5199")
	}
	a.setPreviewStatus("error: " + lastErr.Error())
	return 0, lastErr
}

func (a *App) GetPreviewPort() int {
	a.previewMu.Lock()
	defer a.previewMu.Unlock()
	return a.previewPort
}

func (a *App) KillPreviewServer() {
	a.previewMu.Lock()
	proc := a.previewCmd
	a.previewCmd = nil
	a.previewPort = 0
	if a.previewStatus != "" && !strings.HasPrefix(a.previewStatus, "error:") {
		a.previewStatus = ""
	}
	a.previewMu.Unlock()

	if proc == nil || proc.ProcessID() == 0 {
		return
	}
	killProcessGracefully(proc)
}

func (a *App) atomicWriteFile(path string, content string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	tmpFile, err := os.CreateTemp(filepath.Dir(path), "fabric-*")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()

	defer func() {
		_ = os.Remove(tmpPath)
	}()

	if _, err := tmpFile.WriteString(content); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpPath, 0o644); err != nil {
		return err
	}

	return os.Rename(tmpPath, path)
}

func (a *App) WriteGeneratedCode(code string) error {
	dir, err := a.previewServerDir()
	if err != nil {
		return err
	}
	if err := a.atomicWriteFile(filepath.Join(dir, "src", "Generated.tsx"), code); err != nil {
		return err
	}
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "preview:updated")
	}
	return nil
}

func (a *App) WriteMockData(data string) error {
	dir, err := a.previewServerDir()
	if err != nil {
		return err
	}
	return a.atomicWriteFile(filepath.Join(dir, "src", "mockData.ts"), data)
}
