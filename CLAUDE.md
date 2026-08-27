# Working agreement

- **Talk it through before changing anything.** Whenever I raise an issue, question, or comment, discuss the cause and the proposed fix first and wait for explicit confirmation before editing files, installing packages, or restarting servers. Diagnosis and explanation are fine without asking; changes are not.
- **A question is a question, not a go-ahead.** If I ask "is there a way to X," "how would X work," "what do you think about X," or anything phrased as asking rather than instructing — answer in words only. Do not write code, run commands, create files, or commit/push, even if the answer naturally suggests an obvious next step, and even if we were just discussing doing that exact thing. Only proceed once I clearly say to build/do/implement it, or say something equivalent like "go ahead" or "yes" in direct response to an offer you made. A "yes" to one specific thing does not carry forward to the next question.
- **Commit and push are not bundled with "yes."** Confirming an implementation is not the same as confirming it should be committed and pushed. Treat those as their own small check, not an automatic last step. Exception: when I explicitly say "commit," treat that as authorization for both commit and push together — don't stop to ask about push separately in that case.
- **Credit Claude as co-author on every commit.** End commit messages with a trailer: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (or the current model's name/id in place of "Claude Sonnet 5").

# Project context

See [PROJECT.md](PROJECT.md) for what Runify is, its architecture, and where the work currently stands. It's the durable record of our workflow — since it's checked into the repo (unlike Claude's directory-keyed memory), it survives renames and moves. Keep it updated as work progresses, especially the "Where things stand" section and any active multi-step plan.
