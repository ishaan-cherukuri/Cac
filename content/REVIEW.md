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

## Every topic is now 8 turns

Each of the 30 topics was extended to the SPEC maximum of 8 turns. Turns 1-5 (and 1-6 for
"Ask Ammamma about her childhood" and "Ask Ammamma how to make her pappu") are the original
drafts. **Everything from turn 6 onward is newer and has had less passes over it** — review
those with extra care.

The added turns exist to widen everyday vocabulary, so each topic carries one domain of
ordinary casual speech rather than more of the same scenario words:

| Domain | Topics carrying it |
|---|---|
| weather, seasons | her childhood |
| times of day, daily verbs | your day |
| kitchen staples | her pappu |
| colours, clothes | her wedding |
| phone and messaging | you miss her |
| school | your mother as a child |
| animals | tell you a story |
| numbers 1-10, age | her birthday |
| hours, days off | your job |
| trees, rivers, fields | her village |
| body parts | the song |
| days of the week | what she does all day |
| greetings, thanks, "wait a little" | calling Amma |
| more food words | what Amma cooked |
| cars, buses, commuting | your father |
| salary, saving, spending | your new job |
| months, flights, staying | not visiting |
| rooms, beds, doors, cleaning | parents visiting |
| feelings, staying calm | advice about parents |
| learning and remembering verbs | why Amma never taught you |
| describing a person | your sister |
| feasts, songs, photos | cousin's wedding |
| drinks, spice, the bill | restaurant |
| more vegetables, kilos, change | vegetable market |
| festival words | Sankranti |
| left, right, straight, landmarks | directions |
| games, teams, winning and losing | cricket |
| family terms (maamayya, attayya, pinni, baabaayi) | relative you cannot place |
| baby care | cousin's new baby |
| train times, delays, luggage | train ticket |

Reviewer note: the new model answers were written to stay short and literally sayable by
someone with near-zero production. If any of them needs a construction this user would not
attempt, simplify rather than delete — the vocabulary domain is the point of the turn.

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
