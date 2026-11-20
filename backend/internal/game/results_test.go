package game_test

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"

	"say-it-to-my-boss/backend/internal/game"
)

type practiceAI struct {
	replyFunc
	evaluate func(game.Session) (game.Coaching, error)
}

func (ai practiceAI) Evaluate(_ context.Context, _ game.Scenario, state game.Session) (game.Coaching, error) {
	return ai.evaluate(state)
}

func TestFinishRejectsInvalidCoachingAndSavesOneResult(t *testing.T) {
	catalog, err := game.LoadCatalog("../../../scenarios")
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	ai := practiceAI{
		replyFunc: func(_ context.Context, _ game.Scenario, state game.Session, _ string) (game.NPCReply, error) {
			delta := 10
			return game.NPCReply{Text: "เข้าใจครับ", TrustDelta: &delta, Achieved: []string{state.Objectives[state.Turn].ID}, EndCall: new(state.Turn == 2)}, nil
		},
		evaluate: func(state game.Session) (game.Coaching, error) {
			calls++
			if len(state.Messages) != 7 || state.Status != "succeeded" {
				t.Fatalf("unexpected evaluation input: %+v", state)
			}
			scores := map[string]int{"clarity": 85, "empathy": 75, "professionalism": 90, "problemSolving": 80}
			if calls == 1 {
				scores["clarity"] = 101
			}
			return game.Coaching{
				Scores: scores, Strengths: []string{"บอกเวลาส่งชัดเจน"},
				Suggestions: []string{"ลองทวนแผนก่อนจบ"}, Summary: "ตกลงแผนส่งงานได้",
			}, nil
		},
	}
	ctx := context.Background()
	practice := game.NewPractice(catalog, ai)
	state, err := practice.Start("angry-boss")
	if err != nil {
		t.Fatal(err)
	}
	id := state.ID
	if _, err := practice.Finish(ctx, id); !errors.Is(err, game.ErrConflict) {
		t.Fatalf("early finish error = %v", err)
	}
	for turn := range len(state.Objectives) {
		_, err := practice.Submit(ctx, id, game.SubmitInput{RequestID: fmt.Sprint(turn), Turn: turn, Text: "ขอส่งฉบับย่อก่อนห้าโมงค่ะ"})
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := practice.Finish(ctx, id); !errors.Is(err, game.ErrEvaluationFailed) {
		t.Fatalf("invalid evaluation error = %v", err)
	}
	saved, err := practice.Get(id)
	if err != nil || saved.Results != nil || len(saved.Messages) != 7 {
		t.Fatalf("failed evaluation changed state: %+v, %v", saved, err)
	}
	finished, err := practice.Finish(ctx, id)
	if err != nil || finished.Results == nil || finished.Results.ObjectiveCompletion != 100 {
		t.Fatalf("successful evaluation = %+v, %v", finished, err)
	}
	finished.Results.Scores["clarity"] = 0
	again, err := practice.Finish(ctx, id)
	reloaded, readErr := practice.Get(id)
	if err != nil || readErr != nil || calls != 2 || again.Results.Scores["clarity"] != 85 ||
		!reflect.DeepEqual(again, reloaded) {
		t.Fatalf("cached results = %+v, reloaded = %+v, calls = %d, errors = %v, %v", again, reloaded, calls, err, readErr)
	}
}
