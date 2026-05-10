package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// SessionMeta is persisted to meta.json and returned to the frontend.
type SessionMeta struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ChatMessage is one row in chat.json.
type ChatMessage struct {
	Role         string `json:"role"`
	Content      string `json:"content"`
	TsxGenerated bool   `json:"tsx_generated,omitempty"`
}

type chatFile struct {
	Messages []ChatMessage `json:"messages"`
}

type appState struct {
	ActiveSessionID string `json:"active_session_id"`
}

// SessionData is returned from LoadSession / BootstrapSessions.
type SessionData struct {
	Meta     SessionMeta   `json:"meta"`
	Messages []ChatMessage `json:"messages"`
	PRD      string        `json:"prd"`
}

func (a *App) sessionsDir() (string, error) {
	base, err := a.appDataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "sessions"), nil
}

func (a *App) statePath() (string, error) {
	base, err := a.appDataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "state.json"), nil
}

func (a *App) sessionDir(id string) (string, error) {
	dir, err := a.sessionsDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, id), nil
}

func (a *App) loadAppState() appState {
	path, err := a.statePath()
	if err != nil {
		return appState{}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return appState{}
	}
	var st appState
	if err := json.Unmarshal(data, &st); err != nil {
		return appState{}
	}
	return st
}

func (a *App) persistAppState(activeID string) error {
	path, err := a.statePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	payload := appState{ActiveSessionID: activeID}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "state-*.json")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	_, _ = tmp.Write(data)
	_ = tmp.Close()
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return os.Chmod(path, 0o644)
}

func randomSessionSuffix(n int) string {
	b := make([]byte, (n+1)/2)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString(b)[:n]
	}
	s := hex.EncodeToString(b)
	if len(s) > n {
		return s[:n]
	}
	return s
}

func newSessionID() string {
	ts := time.Now().UTC().Format("2006-01-02_15-04-05")
	return fmt.Sprintf("ses_%s_%s", ts, randomSessionSuffix(4))
}

func truncateSessionTitle(s string, maxRunes int) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "New chat"
	}
	r := []rune(s)
	if len(r) <= maxRunes {
		return s
	}
	cut := string(r[:maxRunes])
	if idx := strings.LastIndex(cut, " "); idx > 8 {
		return strings.TrimSpace(cut[:idx]) + "…"
	}
	return cut + "…"
}

func (a *App) readMetaFile(path string) (SessionMeta, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return SessionMeta{}, err
	}
	var m SessionMeta
	if err := json.Unmarshal(data, &m); err != nil {
		return SessionMeta{}, err
	}
	return m, nil
}

// GetActiveSessionID returns the current active session id (may be empty).
func (a *App) GetActiveSessionID() string {
	a.sessionMu.Lock()
	defer a.sessionMu.Unlock()
	return a.activeSessionID
}

// ListSessions returns all sessions, most recently updated first.
func (a *App) ListSessions() ([]SessionMeta, error) {
	dir, err := a.sessionsDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []SessionMeta{}, nil
		}
		return nil, err
	}
	out := make([]SessionMeta, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		metaPath := filepath.Join(dir, e.Name(), "meta.json")
		m, err := a.readMetaFile(metaPath)
		if err != nil {
			println("Skipping session (bad meta):", e.Name(), err.Error())
			continue
		}
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out, nil
}

func (a *App) writeMeta(path string, m SessionMeta) error {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return a.atomicWriteFile(path, string(data))
}

func (a *App) writeChatFile(sessionPath string, messages []ChatMessage) error {
	path := filepath.Join(sessionPath, "chat.json")
	payload := chatFile{Messages: messages}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return a.atomicWriteFile(path, string(data))
}

func (a *App) readChatFile(sessionPath string) ([]ChatMessage, error) {
	path := filepath.Join(sessionPath, "chat.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []ChatMessage{}, nil
		}
		return nil, err
	}
	var cf chatFile
	if err := json.Unmarshal(data, &cf); err != nil {
		return nil, err
	}
	return cf.Messages, nil
}

func (a *App) placeholderGeneratedTSX() string {
	data, err := fs.ReadFile(previewTemplateFS, filepath.Join(previewTemplateRoot, "src", "Generated.tsx"))
	if err != nil {
		return `export default function Generated() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", width: "100vw", color: "#999999", fontSize: "14px", fontFamily: "Avenir Next, Avenir, system-ui, sans-serif", background: "#FFFFFF" }}>
      Generate something to see preview
    </div>
  );
}
`
	}
	return string(data)
}

// CreateSession creates a new session and sets it active.
func (a *App) CreateSession() (SessionMeta, error) {
	a.sessionMu.Lock()
	defer a.sessionMu.Unlock()

	dir, err := a.sessionsDir()
	if err != nil {
		return SessionMeta{}, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return SessionMeta{}, err
	}

	id := newSessionID()
	sessionPath := filepath.Join(dir, id)
	if err := os.MkdirAll(sessionPath, 0o755); err != nil {
		return SessionMeta{}, err
	}

	now := time.Now().UTC()
	meta := SessionMeta{
		ID:        id,
		Title:     "New chat",
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := a.writeMeta(filepath.Join(sessionPath, "meta.json"), meta); err != nil {
		return SessionMeta{}, err
	}
	if err := a.writeChatFile(sessionPath, nil); err != nil {
		return SessionMeta{}, err
	}

	a.activeSessionID = id
	_ = a.persistAppState(id)

	// New sessions have no cached preview — reset shared Generated.tsx so the iframe shows the placeholder.
	if err := a.WriteGeneratedCode(a.placeholderGeneratedTSX()); err != nil {
		return SessionMeta{}, err
	}

	return meta, nil
}

// LoadSession loads chat + meta, restores preview for this session, sets active.
func (a *App) LoadSession(id string) (SessionData, error) {
	a.sessionMu.Lock()
	defer a.sessionMu.Unlock()

	sessionPath, err := a.sessionDir(id)
	if err != nil {
		return SessionData{}, err
	}
	if _, err := os.Stat(sessionPath); err != nil {
		return SessionData{}, fmt.Errorf("session not found: %w", err)
	}

	meta, err := a.readMetaFile(filepath.Join(sessionPath, "meta.json"))
	if err != nil {
		return SessionData{}, err
	}
	messages, err := a.readChatFile(sessionPath)
	if err != nil {
		return SessionData{}, err
	}

	tsx := a.placeholderGeneratedTSX()
	cachedPath := filepath.Join(sessionPath, "cached_preview.tsx")
	if data, err := os.ReadFile(cachedPath); err == nil && len(strings.TrimSpace(string(data))) > 0 {
		tsx = string(data)
	}
	if err := a.WriteGeneratedCode(tsx); err != nil {
		return SessionData{}, err
	}

	a.activeSessionID = id
	_ = a.persistAppState(id)

	prd := ""
	prdPath := filepath.Join(sessionPath, "prd.md")
	if data, err := os.ReadFile(prdPath); err == nil {
		prd = string(data)
	}

	return SessionData{Meta: meta, Messages: messages, PRD: prd}, nil
}

// SaveSessionPRD writes PRD markdown for a session and notifies listeners.
func (a *App) SaveSessionPRD(id string, prdMarkdown string) error {
	a.sessionMu.Lock()
	defer a.sessionMu.Unlock()

	sessionPath, err := a.sessionDir(id)
	if err != nil {
		return err
	}
	if _, err := os.Stat(sessionPath); err != nil {
		return err
	}

	prdPath := filepath.Join(sessionPath, "prd.md")
	if err := a.atomicWriteFile(prdPath, prdMarkdown); err != nil {
		return err
	}

	meta, err := a.readMetaFile(filepath.Join(sessionPath, "meta.json"))
	if err != nil {
		return err
	}
	meta.UpdatedAt = time.Now().UTC()
	if err := a.writeMeta(filepath.Join(sessionPath, "meta.json"), meta); err != nil {
		return err
	}

	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "prd:updated")
	}
	return nil
}

// GetSessionPRD returns sessions/<id>/prd.md or empty string if missing.
func (a *App) GetSessionPRD(id string) (string, error) {
	sessionPath, err := a.sessionDir(id)
	if err != nil {
		return "", err
	}
	path := filepath.Join(sessionPath, "prd.md")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return string(data), nil
}

// SaveMessages persists chat and updates meta timestamps / auto-title.
func (a *App) SaveMessages(id string, messages []ChatMessage) error {
	a.sessionMu.Lock()
	defer a.sessionMu.Unlock()

	sessionPath, err := a.sessionDir(id)
	if err != nil {
		return err
	}
	if _, err := os.Stat(sessionPath); err != nil {
		return err
	}

	meta, err := a.readMetaFile(filepath.Join(sessionPath, "meta.json"))
	if err != nil {
		return err
	}

	meta.UpdatedAt = time.Now().UTC()

	if meta.Title == "New chat" {
		for _, m := range messages {
			if m.Role == "user" && strings.TrimSpace(m.Content) != "" {
				meta.Title = truncateSessionTitle(m.Content, 40)
				break
			}
		}
	}

	if err := a.writeMeta(filepath.Join(sessionPath, "meta.json"), meta); err != nil {
		return err
	}
	return a.writeChatFile(sessionPath, messages)
}

// SaveSessionPreview writes cached preview + live Generated.tsx and notifies iframe.
func (a *App) SaveSessionPreview(id string, tsxCode string) error {
	a.sessionMu.Lock()
	defer a.sessionMu.Unlock()

	sessionPath, err := a.sessionDir(id)
	if err != nil {
		return err
	}
	if _, err := os.Stat(sessionPath); err != nil {
		return err
	}

	cachedPath := filepath.Join(sessionPath, "cached_preview.tsx")
	if err := a.atomicWriteFile(cachedPath, tsxCode); err != nil {
		return err
	}

	meta, err := a.readMetaFile(filepath.Join(sessionPath, "meta.json"))
	if err != nil {
		return err
	}
	meta.UpdatedAt = time.Now().UTC()
	if err := a.writeMeta(filepath.Join(sessionPath, "meta.json"), meta); err != nil {
		return err
	}

	return a.WriteGeneratedCode(tsxCode)
}

// RenameSession updates the display title in meta.json (folder id unchanged).
func (a *App) RenameSession(id string, newName string) error {
	name := strings.TrimSpace(newName)
	if name == "" {
		return fmt.Errorf("session name cannot be empty")
	}
	if len([]rune(name)) > 80 {
		return fmt.Errorf("session name must be 80 characters or less")
	}

	a.sessionMu.Lock()
	defer a.sessionMu.Unlock()

	sessionPath, err := a.sessionDir(id)
	if err != nil {
		return err
	}
	if _, err := os.Stat(sessionPath); err != nil {
		return fmt.Errorf("session not found: %w", err)
	}

	list, err := a.listSessionsUnlocked()
	if err != nil {
		return err
	}
	for _, other := range list {
		if other.ID != id && strings.TrimSpace(other.Title) == name {
			return fmt.Errorf("another session already uses this name")
		}
	}

	meta, err := a.readMetaFile(filepath.Join(sessionPath, "meta.json"))
	if err != nil {
		return err
	}
	meta.Title = name
	meta.UpdatedAt = time.Now().UTC()
	return a.writeMeta(filepath.Join(sessionPath, "meta.json"), meta)
}

// DeleteSession removes the session folder (idempotent if already gone). Reassigns active or clears it.
func (a *App) DeleteSession(id string) error {
	a.sessionMu.Lock()
	sessionPath, err := a.sessionDir(id)
	if err != nil {
		a.sessionMu.Unlock()
		return err
	}
	if _, statErr := os.Stat(sessionPath); os.IsNotExist(statErr) {
		a.sessionMu.Unlock()
		return nil
	} else if statErr != nil {
		a.sessionMu.Unlock()
		return statErr
	}

	wasActive := a.activeSessionID == id

	if err := os.RemoveAll(sessionPath); err != nil && !os.IsNotExist(err) {
		a.sessionMu.Unlock()
		return err
	}

	if !wasActive {
		a.sessionMu.Unlock()
		return nil
	}

	list, err := a.listSessionsUnlocked()
	if err != nil {
		a.activeSessionID = ""
		_ = a.persistAppState("")
		a.sessionMu.Unlock()
		return err
	}

	if len(list) == 0 {
		a.activeSessionID = ""
		_ = a.persistAppState("")
		a.sessionMu.Unlock()
		return nil
	}

	nextID := list[0].ID
	a.sessionMu.Unlock()
	_, err = a.LoadSession(nextID)
	return err
}

func (a *App) listSessionsUnlocked() ([]SessionMeta, error) {
	dir, err := a.sessionsDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []SessionMeta{}, nil
		}
		return nil, err
	}
	out := make([]SessionMeta, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		metaPath := filepath.Join(dir, e.Name(), "meta.json")
		m, err := a.readMetaFile(metaPath)
		if err != nil {
			continue
		}
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out, nil
}

// BootstrapSessions ensures at least one session and loads the active / default one.
func (a *App) BootstrapSessions() (SessionData, error) {
	a.sessionMu.Lock()

	dir, err := a.sessionsDir()
	if err != nil {
		a.sessionMu.Unlock()
		return SessionData{}, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		a.sessionMu.Unlock()
		return SessionData{}, err
	}

	list, err := a.listSessionsUnlocked()
	if err != nil {
		a.sessionMu.Unlock()
		return SessionData{}, err
	}

	if len(list) == 0 {
		a.sessionMu.Unlock()
		meta, err := a.CreateSession()
		if err != nil {
			return SessionData{}, err
		}
		return a.LoadSession(meta.ID)
	}

	st := a.loadAppState()
	var pick string
	if st.ActiveSessionID != "" {
		p := filepath.Join(dir, st.ActiveSessionID, "meta.json")
		if _, err := os.Stat(p); err == nil {
			pick = st.ActiveSessionID
		}
	}
	if pick == "" {
		pick = list[0].ID
	}

	a.sessionMu.Unlock()
	return a.LoadSession(pick)
}
