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
			return game.NPCReply{Text: "ไม่มีคำตัดสิน", TrustDelta: new(10), Achieved: []string{}}, nil
		}
		if len(state.Messages) != 2*state.Turn+1 {
			t.Errorf("unexpected history: %+v", state.Messages)
		}
		achieved := []string{}
		if state.Turn < len(state.Objectives) {
			achieved = append(achieved, state.Objectives[state.Turn].ID)
		}
		return game.NPCReply{Text: "ตกลงครับ", TrustDelta: new(20), Achieved: achieved, EndCall: new(state.Turn == 3)}, nil
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
	if calls != 4 || saved.Status != "active" || saved.TurnLimit != 0 || len(saved.Messages) != 7 {
		t.Fatalf("AI should continue after three turns: %+v (calls %d)", saved, calls)
	}
	last := game.SubmitInput{RequestID: "last", Turn: 3, Text: "ตกลงตามนี้ค่ะ"}
	for range 2 {
		saved, err = practice.Submit(context.Background(), state.ID, last)
		if err != nil || saved.Status != "succeeded" || saved.EndReason != "npc" ||
			saved.Trust != 100 || saved.Turn != 4 || len(saved.Messages) != 9 || calls != 5 {
			t.Fatalf("unexpected final state after %d reply attempts: %+v, %v", calls, saved, err)
		}
	}
	_, err = practice.Submit(context.Background(), state.ID, game.SubmitInput{RequestID: "extra", Turn: 4, Text: "ยังอยู่ไหม"})
	if !errors.Is(err, game.ErrConflict) {
		t.Fatalf("submission after completion returned %v", err)
	}
}

func TestPlayerHangUpCancelsPendingReply(t *testing.T) {
	catalog, err := game.LoadCatalog("../../../scenarios")
	if err != nil {
		t.Fatal(err)
	}
	replyContext := make(chan context.Context, 1)
	releaseReply := make(chan struct{})
	defer close(releaseReply)
	practice := game.NewPractice(catalog, replyFunc(func(ctx context.Context, _ game.Scenario, _ game.Session, _ string) (game.NPCReply, error) {
		replyContext <- ctx
		<-releaseReply
		delta := 20
		return game.NPCReply{Text: "ตกลงครับ", TrustDelta: &delta, Achieved: []string{}, EndCall: new(true)}, nil
	}))
	initial, err := practice.Start("demanding-client")
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		_, err := practice.Submit(context.Background(), initial.ID, game.SubmitInput{
			RequestID: "pending", Turn: 0, Text: "ขอตรวจสอบก่อนค่ะ",
		})
		result <- err
	}()
	ctx := <-replyContext
	ended, err := practice.EndCall(initial.ID, nil)
	if err != nil || ended.EndReason != "player" || ended.Status != "needs_practice" {
		t.Fatalf("unexpected hang-up state: %+v, %v", ended, err)
	}
	if ctx.Err() != context.Canceled {
		t.Fatalf("pending reply context was not canceled: %v", ctx.Err())
	}
	releaseReply <- struct{}{}
	if err := <-result; !errors.Is(err, game.ErrConflict) {
		t.Fatalf("late reply returned %v", err)
	}
	saved, err := practice.Get(initial.ID)
	if err != nil || saved.EndReason != "player" || saved.Turn != 0 || len(saved.Messages) != 1 {
		t.Fatalf("late reply changed ended session: %+v, %v", saved, err)
	}
}
