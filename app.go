package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// App struct
type App struct {
	ctx             context.Context
	sessionMu       sync.Mutex
	activeSessionID string
	previewMu       sync.Mutex
	previewPort     int
	previewStatus   string
	previewCmd      processKiller
	previewStarting bool
}

type appConfig struct {
	AnthropicAPIKey string `json:"anthropicApiKey"`
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	go func() {
		if _, err := a.EnsurePreviewServer(); err != nil {
			println("Preview server error:", err.Error())
		}
	}()
}

func (a *App) shutdown(ctx context.Context) {
	_ = ctx
	a.KillPreviewServer()
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

func (a *App) configPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}

	return filepath.Join(configDir, "Fabric", "config.json"), nil
}

// SaveApiKey saves the API key to a JSON file in user app data folder.
func (a *App) SaveApiKey(key string) error {
	path, err := a.configPath()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	payload := appConfig{
		AnthropicAPIKey: strings.TrimSpace(key),
	}

	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0o600)
}

// GetApiKey reads the API key from the JSON file.
func (a *App) GetApiKey() string {
	path, err := a.configPath()
	if err != nil {
		return ""
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}

	var payload appConfig
	if err := json.Unmarshal(data, &payload); err != nil {
		return ""
	}

	return strings.TrimSpace(payload.AnthropicAPIKey)
}

// ClearApiKey removes the saved API key.
func (a *App) ClearApiKey() error {
	path, err := a.configPath()
	if err != nil {
		return err
	}

	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}

	return nil
}

func (a *App) setPreviewStatus(status string) {
	a.previewMu.Lock()
	defer a.previewMu.Unlock()
	a.previewStatus = status
}

func (a *App) GetPreviewStatus() string {
	a.previewMu.Lock()
	defer a.previewMu.Unlock()
	return a.previewStatus
}
