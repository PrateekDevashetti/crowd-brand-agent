# Prompting rules

The server injects the brand profile (palette, fonts, tone, style, imagery
guidelines) into every generation. Your prompt should only carry what the
brand profile cannot know: the subject, the moment, the composition.

## Do

- Describe one clear subject and scene: "Product box floating above a tidy
  desk, soft morning window light, a hand reaching into frame."
- Name the medium when it matters: photograph, 3D render, flat illustration,
  editorial collage.
- Specify camera/composition hints for photos: close-up, top-down, shallow
  depth of field, negative space on the left for headline text.
- Keep it to 1–3 sentences.

## Don't

- Don't repeat brand colors, fonts, logo, or tone — the server adds them.
- Don't ask for text-heavy layouts; reserve in-image text for a short
  headline at most, and say exactly what it should read, in quotes.
- Don't stack contradictory styles ("minimal maximalist photo illustration").

## In-image copy

If the image needs a headline, give the exact wording in quotes and where it
sits: `headline "Spring drop is here" top-left, generous margin`. Keep it
under 6 words; image models degrade with long text.
