# Persona Videos

This directory contains video loops for personas/experts that are displayed in the call interface.

## File Naming Convention

Videos should be named using the following format:

- **Concierge**: `concierge.mp4`
- **Experts**: Normalized expert name (lowercase, spaces replaced with hyphens)
  - Example: "Steve Jobs" → `steve-jobs.mp4`
  - Example: "Martin Fowler" → `martin-fowler.mp4`
  - Example: "Robert C. Martin" → `robert-c-martin.mp4`

## Video Specifications

For optimal performance and visual quality:

- **Format**: MP4 (H.264 codec)
- **Resolution**: 256x256px to 512x512px (displayed at 128x128px with circular mask)
- **Duration**: 5-10 second seamless loops
- **File Size**: Keep under 500KB per video
- **Frame Rate**: 24-30fps
- **Audio**: No audio needed (videos are muted)

## Fallback Behavior

The application uses a three-tier fallback system:

1. **Video** (if available in this directory)
2. **Wikipedia/Static Image** with animation (if no video found)
3. **Placeholder Icon** with initials (if no image available)

## Adding a New Video

1. Place your video file in this directory
2. Name it according to the convention above
3. The application will automatically detect and use it

No code changes are required - videos are detected at runtime!

## Current Videos

- `concierge.mp4` - Default AI assistant/concierge
