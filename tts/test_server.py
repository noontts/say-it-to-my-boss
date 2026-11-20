import unittest
from unittest.mock import Mock

import numpy as np

from server import synthesize


class SpeechEndingTest(unittest.TestCase):
    def setUp(self):
        self.engine = Mock()
        self.engine.tts.return_value = np.array([0.25, -0.25], dtype=np.float32)
        self.engine.stream.return_value = iter([b"\x01\x00"])

    def test_short_question_has_no_extra_end_phone(self):
        list(synthesize(self.engine, "เกิดอะไรขึ้นครับ?", "newvoice_male"))
        self.engine.tts.assert_called_once_with(
            "เกิดอะไรขึ้นครับ", speaker_idx="newvoice_male", return_type="waveform"
        )

    def test_stream_keeps_question_boundaries_without_speaking_the_marks(self):
        list(synthesize(
            self.engine,
            "รายงานเลยกำหนดแล้ว เกิดอะไรขึ้นครับ？！ แล้วพรุ่งนี้จะส่งให้ผมได้กี่โมงครับ?",
            "newvoice_male",
        ))
        self.engine.stream.assert_called_once_with(
            "รายงานเลยกำหนดแล้ว เกิดอะไรขึ้นครับ\nแล้วพรุ่งนี้จะส่งให้ผมได้กี่โมงครับ",
            speaker_idx="newvoice_male",
            return_type="bytes",
        )


if __name__ == "__main__":
    unittest.main()
