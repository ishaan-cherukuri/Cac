# Native speaker review — Telugu content

**Status: 0 of 30 topics verified. Nothing here is cleared to ship.**

Every topic in `content/topics/` was drafted by Claude and carries `"verified": false`.
The Telugu is plausible but unverified — expect errors in register, verb agreement, and
word choice that a native speaker will catch instantly and a model will not.

`assertShippable()` throws while any topic is unverified, so this cannot be forgotten
by accident.

## What a reviewer needs to check

Per topic, in priority order:

1. **Does Ammamma sound like a real grandmother?** Not a textbook, not a news reader.
   Slightly informal, warm, a little repetitive. If a line sounds like it came from a
   language course, it is wrong even if it is grammatically perfect.
2. **Is the register right for an elder speaking to a grandchild?** Check the
   పిల్లలతో మాట్లాడే tone — verb endings, the use of కన్నా / నాన్నా as endearments.
3. **Is the model answer something this user could actually say?** The target user is a
   receptive bilingual with near-zero production. If the model answer needs a
   construction they'd never attempt, simplify it.
4. **Is the transliteration readable?** Most users cannot read Telugu script at all —
   the romanization is their only access to the text. It should map to how the word
   actually sounds, not to a formal scheme.
5. **Does anything shame the learner?** No correction, no "that's not right," nothing
   that implies the user should already know this.

## Dialect — decided: Coastal Andhra

Ammamma speaks **Coastal Andhra** Telugu. The drafts were already written in a broadly
Coastal Andhra / standard-written register, so no rewrite is needed.

**Reviewer instruction:** normalize toward Coastal Andhra throughout. Where a line reads
as Telangana or Rayalaseema, or drifts into formal written Telugu, pull it back. Do not
mix registers between topics — a persona whose dialect shifts between sessions stops
sounding like one person.

## How to review

1. Open the JSON file for a bucket (`grandparent.json`, `parent.json`, `general.json`).
2. Read each topic aloud. Reading aloud catches unnatural phrasing that silent
   reading does not.
3. Edit the Telugu and transliteration in place.
4. Flip `"verified": false` to `"verified": true` — **only** for topics you have read
   completely.
5. Run `npm run content:validate` to confirm nothing broke structurally.

Partial progress is fine and expected. Verify what you have read; leave the rest false.

## Balance is already enforced

`npm run content:validate` checks the SPEC section 7 requirements automatically:

| Bucket | Count | Share | Required |
|---|---|---|---|
| grandparent | 12 | 40% | ≥40% |
| parent | 9 | 30% | ≥30% |
| general (cousin + cultural) | 9 | 30% | ≥30% |

If you cut a topic, the validator will fail until balance is restored. Replace rather
than delete.
