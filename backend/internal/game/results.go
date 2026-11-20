package game

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

var ErrEvaluationFailed = errors.New("practice coaching unavailable")

type Coaching struct {
	Scores      map[string]int `json:"scores"`
	Strengths   []string       `json:"strengths"`
	Suggestions []string       `json:"suggestions"`
	Summary     string         `json:"summary"`
}

type Results struct {
	Coaching
	ObjectiveCompletion int `json:"objectiveCompletion"`
}

var coachingDimensions = [...]string{"clarity", "empathy", "professionalism", "problemSolving"}

func (coaching Coaching) valid() bool {
	if len(coaching.Scores) != len(coachingDimensions) || coaching.Strengths == nil ||
		len(coaching.Strengths) > 3 || len(coaching.Suggestions) < 1 || len(coaching.Suggestions) > 3 ||
		!validCoachingText(coaching.Summary) {
		return false
	}
	for _, dimension := range coachingDimensions {
		score, ok := coaching.Scores[dimension]
		if !ok || score < 0 || score > 100 {
			return false
		}
	}
	for _, items := range [][]string{coaching.Strengths, coaching.Suggestions} {
		for _, item := range items {
			if !validCoachingText(item) {
				return false
			}
		}
	}
	return true
}

func validCoachingText(text string) bool {
	return strings.TrimSpace(text) != "" && utf8.RuneCountInString(text) <= 500
}

// Finish saves one evaluation per completed session. Failures leave the transcript available for a retry.
func (p *Practice) Finish(ctx context.Context, id string) (Session, error) {
	p.mu.Lock()
	entry, ok := p.sessions[id]
	if !ok || (!entry.busy() && !entry.expires.After(time.Now())) {
		p.mu.Unlock()
		return Session{}, ErrNotFound
	}
	if entry.state.Results != nil {
		state := snapshot(entry.state)
		p.mu.Unlock()
		return state, nil
	}
	if entry.state.Status == "active" || entry.evaluating {
		p.mu.Unlock()
		return Session{}, ErrConflict
	}
	entry.evaluating = true
	state := snapshot(entry.state)
	p.mu.Unlock()

	defer func() {
		p.mu.Lock()
		entry.evaluating = false
		p.mu.Unlock()
	}()

	var coaching Coaching
	var err error
	if p.ai == nil {
		coaching = localCoaching(state)
	} else {
		scenario, _ := p.catalog.Get(state.ScenarioID)
		coaching, err = p.ai.Evaluate(ctx, scenario, state)
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if err != nil || ctx.Err() != nil || !coaching.valid() {
		return Session{}, ErrEvaluationFailed
	}
	entry.state.Results = &Results{
		Coaching: coaching, ObjectiveCompletion: 100 * len(state.Achieved) / len(state.Objectives),
	}
	entry.expires = time.Now().Add(sessionLifetime)
	return snapshot(entry.state), nil
}

func localReply(spec *PracticeSpec, state Session, text string) NPCReply {
	achieved := []string{}
	for _, objective := range spec.Objectives {
		if len(objective.LocalCues) == 0 || slices.Contains(state.Achieved, objective.ID) {
			continue
		}
		matched := true
		for _, group := range objective.LocalCues {
			if !containsCue(text, group...) {
				matched = false
				break
			}
		}
		if matched {
			achieved = append(achieved, objective.ID)
		}
	}
	delta := min(20, 10*len(achieved))
	return NPCReply{Text: spec.LocalReplies[state.Turn], TrustDelta: &delta, Achieved: achieved}
}

func containsCue(text string, cues ...string) bool {
	return slices.ContainsFunc(cues, func(cue string) bool { return strings.Contains(text, cue) })
}

func localCoaching(state Session) Coaching {
	var playerLines []string
	for _, message := range state.Messages {
		if message.Role == "player" {
			playerLines = append(playerLines, message.Text)
		}
	}
	text := strings.Join(playerLines, "\n")
	coaching := Coaching{
		Scores: map[string]int{
			"clarity":         localScore(text, []string{"เพราะ", "เนื่องจาก", "ตอนนี้"}, []string{"โมง", "น.", "ภายใน", "วัน"}),
			"empathy":         localScore(text, []string{"เข้าใจ", "ทราบว่า", "เห็นว่า"}, []string{"ขอโทษ", "ขอบคุณ", "เสียเวลา"}),
			"professionalism": localScore(text, []string{"ค่ะ", "ครับ", "คะ"}, []string{"ขอ", "ยินดี", "ช่วย"}),
			"problemSolving":  localScore(text, []string{"เสนอ", "ส่ง", "ตรวจ", "เช็ก"}, []string{"แจ้ง", "อัปเดต", "ติดต่อ", "ภายใน"}),
		},
		Strengths: []string{}, Suggestions: []string{},
		Summary: "ลองนำคำแนะนำไปใช้ในรอบถัดไป แล้วสังเกตว่าคู่สนทนาจะวางแผนจากคำตอบของคุณได้ง่ายขึ้นไหม",
	}
	for _, objective := range state.Objectives {
		if slices.Contains(state.Achieved, objective.ID) {
			coaching.Strengths = append(coaching.Strengths, objective.Description)
		} else {
			coaching.Suggestions = append(coaching.Suggestions, objective.Description)
		}
	}
	if len(coaching.Suggestions) == 0 {
		coaching.Suggestions = append(coaching.Suggestions, "ก่อนจบ ลองทวนสิ่งที่ตกลงกันและเปิดโอกาสให้อีกฝ่ายถามเพิ่มเติม")
	}
	coaching.Strengths = coaching.Strengths[:min(3, len(coaching.Strengths))]
	coaching.Suggestions = coaching.Suggestions[:min(3, len(coaching.Suggestions))]
	return coaching
}

func localScore(text string, first, second []string) int {
	score := 0
	for _, cues := range [][]string{first, second} {
		if containsCue(text, cues...) {
			score += 50
		}
	}
	return score
}
