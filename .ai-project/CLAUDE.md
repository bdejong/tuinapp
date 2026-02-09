# TuinApp - Garden Management Application

## Project Overview

A desktop application for managing garden activities, including tracking plants (sowing/planting schedules), garden activities, and seed packet photos.

**Primary user:** Desktop/laptop browser (not mobile-first)

## Technology Stack

- **Backend:** Rust with Tauri framework
- **Frontend:** Vue.js
- **Database:** SQLite (single file, easy to backup to Google Drive)
- **Image storage:** Binary blobs in SQLite database

## Key Design Decisions

### Data Model

**Plants:**
- Name, plant type (vegetable/fruit, flower, herb), sun requirement (3 levels), notes field
- Sowing periods: 24 checkboxes (12 months x early/late) stored as bitmask
- Planting periods: 24 checkboxes stored as bitmask
- Multiple photos with sort order (for seed packet front/back)

**Activities:**
- Name, description
- Active periods: 24 checkboxes stored as bitmask (same as plants)

### Sun Requirement Levels
1. Full sun
2. Partial shade
3. Full shade

### Views
1. Plant entry/edit page with camera capture for photos
2. Plant overview grid (months as columns, plants as rows)
3. Activity management page
4. Monthly calendar view (what to sow/plant/do this month)

### Photo Handling
- Multiple photos per plant (for seed packet front/back)
- Direct capture via computer's built-in camera
- Stored as binary blobs in SQLite
- Ordered by sort_order field

## File Structure

```
tuinapp/
├── .ai-project/          # AI project documentation
│   ├── CLAUDE.md         # This file - project context
│   └── design.md         # Detailed design document
├── src-tauri/            # Rust backend
├── src/                  # Vue.js frontend
└── README.md
```
