package game

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	MaxMessageLength = 1000
	initialTrust     = 50
	callbackTrust    = 35
	callbackOpening  = "เมื่อกี้ผมโทรไปแล้วคุณไม่ได้รับสาย ตอนนี้รายงานไปถึงไหนแล้วครับ?"
	sessionLifetime  = 2 * time.Hour
	maxSessions      = 1000
)

var (
	ErrNotFound           = errors.New("session or scenario not found")
	ErrNotPlayable        = errors.New("scenario is not playable")
	ErrInvalidTurn        = errors.New("invalid message or turn")
	ErrInvalidOfficeEntry = errors.New("invalid office entry")
	ErrConflict           = errors.New("session is busy, finished, or on a different turn")
	ErrAtCapacity         = errors.New("session capacity reached")
	ErrReplyFailed        = errors.New("NPC reply unavailable")
)

type Objective struct {
	ID          string `json:"id"`
	Description string `json:"description"`
}

type PracticeSpec struct {
	Persona      string              `json:"persona"`
	Opening      string              `json:"opening"`
	Objectives   []practiceObjective `json:"objectives"`
	TurnLimit    int                 `json:"turnLimit"`
	MinimumTrust int                 `json:"minimumTrust"`
	LocalReplies []string            `json:"localReplies"`
}

type practiceObjective struct {
	Objective
	LocalCues [][]string `json:"localCues"`
}

func (spec PracticeSpec) validate() error {
	if err := requireText("persona", spec.Persona, "opening", spec.Opening); err != nil {
		return err
	}
	if spec.TurnLimit < 1 || spec.TurnLimit > 10 || len(spec.LocalReplies) != spec.TurnLimit ||
		spec.MinimumTrust < 1 || spec.MinimumTrust > 100 || len(spec.Objectives) == 0 {
		return errors.New("invalid turn limit, local replies, minimum trust, or objectives")
	}
	ids := make(map[string]bool)
	for _, objective := range spec.Objectives {
		if err := requireText("objective id", objective.ID, "objective description", objective.Description); err != nil {
			return err
		}
		if ids[objective.ID] {
			return fmt.Errorf("duplicate objective %q", objective.ID)
		}
		ids[objective.ID] = true
		for _, group := range objective.LocalCues {
			if len(group) == 0 || slices.ContainsFunc(group, func(cue string) bool { return strings.TrimSpace(cue) == "" }) {
				return fmt.Errorf("objective %q contains empty local cues", objective.ID)
			}
		}
	}
	for _, reply := range spec.LocalReplies {
		if err := requireText("local reply", reply); err != nil {
			return err
		}
	}
	return nil
}

type Message struct {
	Role string `json:"role"`
	Text string `json:"text"`
}

type Session struct {
	ID          string      `json:"id"`
	ScenarioID  string      `json:"scenarioId"`
	OfficeEntry string      `json:"officeEntry,omitempty"`
	Messages    []Message   `json:"messages"`
	Objectives  []Objective `json:"objectives"`
	Achieved    []string    `json:"achieved"`
	Turn        int         `json:"turn"`
	TurnLimit   int         `json:"turnLimit,omitempty"`
	Trust       int         `json:"trust"`
	Mood        string      `json:"mood"`
	Status      string      `json:"status"`
	EndReason   string      `json:"endReason,omitempty"`
	Mode        string      `json:"mode"`
	Results     *Results    `json:"results,omitempty"`
}

type NPCReply struct {
	Text       string   `json:"reply"`
	TrustDelta *int     `json:"trustDelta"`
	Achieved   []string `json:"achieved"`
	EndCall    *bool    `json:"endCall,omitempty"`
}

type PracticeAI interface {
	Reply(context.Context, Scenario, Session, string) (NPCReply, error)
	Evaluate(context.Context, Scenario, Session) (Coaching, error)
}

// SubmitInput identifies a message independently of its HTTP request so it can be retried.
type SubmitInput struct {
	RequestID string `json:"requestId"`
	Turn      int    `json:"turn"`
	Text      string `json:"text"`
}

type sessionEntry struct {
	state       Session
	submissions []SubmitInput
	expires     time.Time
	cancelReply context.CancelFunc
	evaluating  bool
}

func (entry *sessionEntry) busy() bool {
	return entry.cancelReply != nil || entry.evaluating
}

type Practice struct {
	mu       sync.Mutex
	sessions map[string]*sessionEntry
	catalog  *Catalog
	ai       PracticeAI
}

func NewPractice(catalog *Catalog, ai PracticeAI) *Practice {
	return &Practice{sessions: make(map[string]*sessionEntry), catalog: catalog, ai: ai}
}

func (p *Practice) Start(scenarioID string) (Session, error) {
	return p.StartWithOfficeEntry(scenarioID, "")
}

func (p *Practice) StartWithOfficeEntry(scenarioID, officeEntry string) (Session, error) {
	if officeEntry != "" && (scenarioID != "angry-boss" || (officeEntry != "answer" && officeEntry != "callback")) {
		return Session{}, ErrInvalidOfficeEntry
	}
	scenario, ok := p.catalog.Get(scenarioID)
	if !ok {
		return Session{}, ErrNotFound
	}
	spec := scenario.Practice
	if spec == nil {
		return Session{}, ErrNotPlayable
	}
	mode := "local"
	turnLimit := spec.TurnLimit
	if p.ai != nil {
		mode = "ai"
		turnLimit = 0
	}
	objectives := make([]Objective, 0, len(spec.Objectives))
	for _, objective := range spec.Objectives {
		objectives = append(objectives, objective.Objective)
	}
	trust, opening := initialTrust, spec.Opening
	if officeEntry == "callback" {
		trust, opening = callbackTrust, callbackOpening
	}
	state := Session{
		ID: rand.Text(), ScenarioID: scenarioID, OfficeEntry: officeEntry, TurnLimit: turnLimit,
		Messages: []Message{{Role: "npc", Text: opening}}, Objectives: objectives,
		Achieved: []string{}, Trust: trust, Mood: mood(trust), Status: "active", Mode: mode,
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	for id, entry := range p.sessions {
		if !entry.busy() && !entry.expires.After(now) {
			delete(p.sessions, id)
		}
	}
	if len(p.sessions) >= maxSessions {
		return Session{}, ErrAtCapacity
	}
	p.sessions[state.ID] = &sessionEntry{state: state, expires: now.Add(sessionLifetime)}
	return snapshot(state), nil
}

func (p *Practice) Get(id string) (Session, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	entry, ok := p.sessions[id]
	if !ok || (!entry.busy() && !entry.expires.After(time.Now())) {
		return Session{}, ErrNotFound
	}
	return snapshot(entry.state), nil
}

// EndCall with a turn ends a boss call after silence. Without a turn, the player is hanging up.
func (p *Practice) EndCall(id string, silentTurn *int) (Session, error) {
	if silentTurn != nil && *silentTurn < 0 {
		return Session{}, ErrInvalidTurn
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	entry, ok := p.sessions[id]
	if !ok || (!entry.busy() && !entry.expires.After(now)) {
		return Session{}, ErrNotFound
	}
	state := &entry.state
	if silentTurn != nil {
		if state.ScenarioID != "angry-boss" || state.Turn != *silentTurn {
			return Session{}, ErrConflict
		}
		if state.EndReason == "silence" {
			return snapshot(*state), nil
		}
		if entry.busy() || state.Status != "active" {
			return Session{}, ErrConflict
		}
		state.Messages = append(state.Messages,
			Message{Role: "npc", Text: bossReminder},
			Message{Role: "npc", Text: "งั้นไว้ค่อยคุยกันครับ"},
		)
		state.EndReason = "silence"
	} else {
		if state.Status != "active" {
			return snapshot(*state), nil
		}
		if entry.cancelReply != nil {
			entry.cancelReply()
		}
		state.EndReason = "player"
	}

	state.Status = "needs_practice"
	entry.expires = now.Add(sessionLifetime)
	return snapshot(*state), nil
}

func (p *Practice) Submit(ctx context.Context, id string, input SubmitInput) (Session, error) {
	input.Text = strings.TrimSpace(input.Text)
	if input.Text == "" || utf8.RuneCountInString(input.Text) > MaxMessageLength ||
		input.RequestID == "" || len(input.RequestID) > 64 || input.Turn < 0 {
		return Session{}, ErrInvalidTurn
	}
	p.mu.Lock()
	entry, ok := p.sessions[id]
	if !ok || (!entry.busy() && !entry.expires.After(time.Now())) {
		p.mu.Unlock()
		return Session{}, ErrNotFound
	}
	for _, previous := range entry.submissions {
		if previous.RequestID == input.RequestID {
			state := snapshot(entry.state)
			p.mu.Unlock()
			if previous != input {
				return Session{}, ErrConflict
			}
			return state, nil
		}
	}
	if entry.busy() || entry.state.Status != "active" || input.Turn != entry.state.Turn {
		p.mu.Unlock()
		return Session{}, ErrConflict
	}
	replyContext, cancelReply := context.WithCancel(ctx)
	entry.cancelReply = cancelReply
	state := snapshot(entry.state)
	p.mu.Unlock()

	defer func() {
		cancelReply()
		p.mu.Lock()
		entry.cancelReply = nil
		p.mu.Unlock()
	}()

	scenario, _ := p.catalog.Get(state.ScenarioID)
	spec := scenario.Practice
	result := NPCReply{}
	if p.ai == nil {
		result = localReply(spec, state, input.Text)
	} else {
		var err error
		result, err = p.ai.Reply(replyContext, scenario, state, input.Text)
		if err != nil || result.EndCall == nil {
			return Session{}, ErrReplyFailed
		}
	}
	if !applyReply(&state, result) {
		return Session{}, ErrReplyFailed
	}
	state.Messages = append(state.Messages, Message{Role: "player", Text: input.Text},
		Message{Role: "npc", Text: strings.TrimSpace(result.Text)})
	state.Turn++
	if result.EndCall != nil && *result.EndCall {
		state.EndReason = "npc"
	}
	if state.EndReason == "npc" || state.Turn == state.TurnLimit {
		if len(state.Achieved) == len(state.Objectives) && state.Trust >= spec.MinimumTrust {
			state.Status = "succeeded"
		} else {
			state.Status = "needs_practice"
		}
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if entry.state.Status != "active" {
		return Session{}, ErrConflict
	}
	if replyContext.Err() != nil {
		return Session{}, ErrReplyFailed
	}
	entry.state = state
	entry.submissions = append(entry.submissions, input)
	entry.expires = time.Now().Add(sessionLifetime)
	return snapshot(state), nil
}

func applyReply(state *Session, reply NPCReply) bool {
	if strings.TrimSpace(reply.Text) == "" || utf8.RuneCountInString(reply.Text) > MaxMessageLength ||
		reply.TrustDelta == nil || *reply.TrustDelta < -20 || *reply.TrustDelta > 20 || reply.Achieved == nil {
		return false
	}
	for _, id := range reply.Achieved {
		if !slices.ContainsFunc(state.Objectives, func(objective Objective) bool { return objective.ID == id }) {
			return false
		}
		if !slices.Contains(state.Achieved, id) {
			state.Achieved = append(state.Achieved, id)
		}
	}
	state.Trust = min(100, max(0, state.Trust+*reply.TrustDelta))
	state.Mood = mood(state.Trust)
	return true
}

func mood(trust int) string {
	switch {
	case trust < 40:
		return "frustrated"
	case trust >= 70:
		return "reassured"
	default:
		return "concerned"
	}
}

func snapshot(state Session) Session {
	state.Messages = slices.Clone(state.Messages)
	state.Objectives = slices.Clone(state.Objectives)
	state.Achieved = slices.Clone(state.Achieved)
	if state.Results != nil {
		results := *state.Results
		results.Scores = maps.Clone(state.Results.Scores)
		results.Strengths = slices.Clone(results.Strengths)
		results.Suggestions = slices.Clone(results.Suggestions)
		state.Results = &results
	}
	return state
}
