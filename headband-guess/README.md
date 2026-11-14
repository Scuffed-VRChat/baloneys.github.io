# Headband Guess character artwork

592 numbered PNGs cover all 73 categories. Every image is 400 x 460 pixels, matching
the card image area's 20:23 aspect ratio. Artwork is fitted without stretching and
with 16 pixels of padding; original backgrounds are retained. This is a mixed
collection of renders, portraits, sprites and game stills, not a uniformly transparent
or uniformly licensed art set. `sources.json` records the original page/image URLs
and hashes for every file.

The master uses permanent character IDs and image indices. Slots 0000 through 0591
are populated. All 8,192 image URL slots remain reserved in the world; unused links
require no placeholder files. `availableImageIndices`, `availableImageCount`, highest
indices, PNG dimensions/bytes and SHA-256 hashes are maintained by
`python headband-guess/update_manifest.py` from the website repository root.

The image URLs baked in the world point directly to
`https://kanaris-beans.com/headband-guess/images/NNNN.png`. JSON carries indices and
relative inventory paths; changing artwork within reserved slots needs no URL rebake.
Leave/re-enter the game area to refresh the local catalog and cache. This custom
domain requires VRChat's Allow Untrusted URLs setting.

The catalog includes accepted short names, nicknames and full-name equivalents.
Default scoring in the updated game is 10 points for canonical/full-name answers,
7 for accepted aliases, and 5 for outlasting an opponent's lives. Formatting is
ignored; answers are not matched by arbitrary substrings or fuzzy similarity.
The existing 5-shot win reward remains independent of answer precision.

Visual review rejected generic logos, unrelated same-name matches and wrong-character
results. Three records use shared canonical illustrations: Theo's grandfather (0302)
appears beside young Granny in Celeste's ending photo; Snugglepot/Cuddlepie (0582 and
0583) use the classic illustration showing the pair together. These compositions are
explicitly noted in the source index rather than assigned to invented solo portraits.

To update, keep IDs/slots stable, put replacement PNGs in `images`, refresh the master,
and review/commit only the intended files. The updater skips absent/one-pixel files,
validates PNG CRCs and dimensions up to 2048 pixels, supports sparse indices, and
changes the content version when image hashes or catalog data change.

Cache defaults: 24 resident images, 32 MiB, 8 warm images, bounded by Inspector caps.
Current cards have priority. VRChat multiplayer, headset behaviour, persistence and
currency payout execution require in-client verification.
