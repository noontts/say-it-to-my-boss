package game

import "context"

// MockPracticeAI exercises AI-mode dialogue with local scoring and sample Thai replies.
type MockPracticeAI struct{}

var mockReplies = map[string][]string{
	"angry-boss": {
		"โอเคครับ ตอนนี้มีส่วนไหนพร้อมให้ผมเอาไปเตรียมประชุมก่อนบ้าง?",
		"ได้ครับ แล้วรายงานฉบับเต็มจะส่งถึงผมกี่โมง?",
		"รับทราบครับ ถ้าเห็นว่าจะไม่ทัน ช่วยบอกผมทันทีนะครับ ขอบคุณครับ",
	},
	"demanding-client": {
		"เข้าใจค่ะ งั้นขอเริ่มจากภาพหลักก่อน ทีมคุณส่งได้วันไหนคะ?",
		"ได้ค่ะ แล้วไฟล์ที่เหลือจะพร้อมให้ทีมเราลงวันไหนคะ?",
		"โอเคค่ะ ฉันจะบอกทีมให้จัดคิวตามนี้ ถ้าเวลาขยับ ฝากแจ้งฉันด้วยนะคะ",
	},
	"difficult-customer": {
		"ค่ะ พอดีฉันเพิ่งเห็นว่าเลยกำหนดคืนแล้ว ทางร้านยังช่วยอะไรได้บ้างคะ?",
		"ถ้าต้องเอาเครื่องมาตรวจ ฉันต้องเตรียมอะไรไปด้วย แล้วจะรู้ผลวันไหนคะ?",
		"เข้าใจแล้วค่ะ เดี๋ยวฉันเตรียมเครื่องกับใบเสร็จไว้ ขอบคุณที่ช่วยนะคะ",
	},
}

func (MockPracticeAI) Reply(_ context.Context, scenario Scenario, state Session, text string) (NPCReply, error) {
	reply := localReply(scenario.Practice, state, text)
	if lines := mockReplies[scenario.ID]; state.Turn < len(lines) {
		reply.Text = lines[state.Turn]
	}
	return reply, nil
}

func (MockPracticeAI) Evaluate(_ context.Context, _ Scenario, state Session) (Coaching, error) {
	return localCoaching(state), nil
}
