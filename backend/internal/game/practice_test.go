package game_test

import (
	"context"
	"errors"
	"testing"

	"say-it-to-my-boss/backend/internal/game"
)

type replyFunc func(context.Context, game.Scenario, game.Session, string) (game.NPCReply, error)

func (f replyFunc) Reply(ctx context.Context, scenario game.Scenario, state game.Session, text string) (game.NPCReply, error) {
	return f(ctx, scenario, state, text)
}

func (f replyFunc) Evaluate(context.Context, game.Scenario, game.Session) (game.Coaching, error) {
	return game.Coaching{}, errors.New("unexpected evaluation")
}

func TestPracticeCommitsOnlyValidTurns(t *testing.T) {
	catalog, err := game.LoadCatalog("../../../scenarios")
	if err != nil {
		t.Fatal(err)
	}
	replyStarted := make(chan struct{})
	releaseReply := make(chan struct{})
	calls := 0
	practice := game.NewPractice(catalog, replyFunc(func(_ context.Context, _ game.Scenario, state game.Session, _ string) (game.NPCReply, error) {
		calls++
		if calls == 1 {
			close(replyStarted)
			<-releaseReply
			return game.NPCReply{Text: "invalid response"}, nil
		}
		if len(state.Messages) != 2*state.Turn+1 {
			t.Errorf("unexpected history: %+v", state.Messages)
		}
		delta := 20
		return game.NPCReply{Text: "ตกลงครับ", TrustDelta: &delta, Achieved: []string{state.Objectives[state.Turn].ID}}, nil
	}))
	state, err := practice.Start("angry-boss")
	if err != nil {
		t.Fatal(err)
	}
	input := game.SubmitInput{RequestID: "first", Text: "ขอโทษที่ส่งช้าค่ะ"}
	first := make(chan error, 1)
	go func() {
		_, err := practice.Submit(context.Background(), state.ID, input)
		first <- err
	}()

	<-replyStarted
	_, concurrentErr := practice.Submit(context.Background(), state.ID, input)
	close(releaseReply)
	if firstErr := <-first; !errors.Is(firstErr, game.ErrReplyFailed) || !errors.Is(concurrentErr, game.ErrConflict) {
		t.Fatalf("first returned %v, concurrent returned %v", firstErr, concurrentErr)
	}
	saved, err := practice.Get(state.ID)
	if err != nil || saved.Turn != 0 || len(saved.Messages) != 1 {
		t.Fatalf("failed turn changed session: %+v, %v", saved, err)
	}
	for _, turn := range []game.SubmitInput{
		input,
		input,
		{RequestID: "second", Turn: 1, Text: "ส่งฉบับย่อวันนี้ค่ะ"},
		{RequestID: "third", Turn: 2, Text: "ส่งฉบับเต็มพรุ่งนี้ค่ะ"},
	} {
		saved, err = practice.Submit(context.Background(), state.ID, turn)
		if err != nil {
			t.Fatal(err)
		}
	}
	if calls != 4 || saved.Status != "succeeded" || saved.Trust != 100 || len(saved.Messages) != 7 {
		t.Fatalf("unexpected final state after %d reply attempts: %+v", calls, saved)
	}
	_, err = practice.Submit(context.Background(), state.ID, game.SubmitInput{RequestID: "extra", Turn: 3, Text: "เกินรอบ"})
	if !errors.Is(err, game.ErrConflict) {
		t.Fatalf("submission after completion returned %v", err)
	}
}
