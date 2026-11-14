# Headband Guess data

`master.json` is the downloadable character catalog, image inventory and cache policy.
The world bakes 8,192 URLs: `https://kanaris-beans.com/headband-guess/images/0000.png`
through `8191.png`. Reserved slots need no files and consume zero hosted image bytes.
This is the application's reserved capacity, not a VRChat platform maximum.

The initial catalog has 73 categories and 592 characters. Image slots 0–591 are assigned;
no artwork is available yet. `availableImageIndices` is initially empty, so clients do
not request reserved/missing URLs. `highestAssignedImageIndex` and
`highestAvailableImageIndex` are separate. `iconImageIndex` reuses the same image for
thumbnails and cards, avoiding a second download.

## Adding artwork

1. Put real PNG artwork in `images/NNNN.png`, using the record's `imageIndex` padded
   to four digits. Use at most 2048×2048 pixels; 256–512 pixels is usually enough.
2. Run `python headband-guess/update_manifest.py` from the repo root.
3. Review and commit only the intended files. Publish the site normally.

The updater validates PNG structure and CRCs, skips 1-pixel placeholders, lists only
existing assigned images, updates counts/highest indices and derives a content version.
It never creates thousands of placeholders. Matching file names are an index contract;
they do not establish that the artwork depicts the correct character.

Edit names, aliases, categories, traits and permanent IDs in `master.json`. Keep IDs and
image indices stable: append new entries; never recycle an existing character ID or slot.
The updater checks unique ascending IDs, category/trait references, unique slots and
capacity. No runtime URL construction is used: JSON contains indices and relative inventory
paths, while Unity ships the VRCUrl list. Adding records/art within reserved slots needs
no new image URLs baked into the world. Increasing capacity requires a world update.

## Cache policy

`availableImageCount` must equal the available-index list length. Sparse indices are
supported; clients do not assume every index below the highest exists.
`cache.maxResidentImages` defaults to 24, `maxResidentMemoryMB` to 32, and
`preloadImageCount` to 8. Unity's Inspector values remain hard upper bounds.
Current-round images have priority; warming uses mutual categories. Each client clears
its own catalog and textures when leaving the game/spectator area. Re-enter to load an
updated catalog. Different catalog versions cannot ready up together.

The site has a custom domain. Use the direct custom-domain URLs above, not a GitHub
Pages URL which redirects. VRChat users need Allow Untrusted URLs for this custom
domain unless VRChat adds it to the relevant allowlists.
