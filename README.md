# Dispatches

A slow-social platform for sharing what you're working on and following your friends. Post a **dispatch** with a title, a few words, and an image; like and reply in nested threads; keep a profile with an avatar and a status. Built on a **GraphQL API** backend and a **React** frontend, secured with JWT authentication — and finished with a warm, hand-built design system (Cohost/Tumblr energy, not another blue-and-white feed).

**Live Demo:** [dispatches-three.vercel.app](https://dispatches-three.vercel.app)  
**API:** [node-social-zmra.onrender.com/graphql](https://node-social-zmra.onrender.com/graphql)

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Design System](#design-system)
- [Architecture](#architecture)
- [GraphQL API](#graphql-api)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Scripts](#scripts)

---

## Features

### Accounts & Auth
- **Sign up with an avatar** — name, email, password (min 5 chars), and an optional profile photo (PNG/JPG/WebP, ≤5 MB) uploaded at signup with a live preview and remove/change controls.
- **JWT sessions** — passwords hashed with bcryptjs; a token is issued on login, stored with a 1-hour expiry, and the client auto-logs-out when it lapses (and immediately on load if already expired).
- **Editable status** — every user carries a short status message (defaults to `"I am new!"`).

### Dispatches (posts)
- **Create, edit, delete** — a modal composer takes a title (min 5), content (min 5), and a required image (≤10 MB). Only the author sees edit/delete controls on their own dispatches.
- **Optimistic feed** — new posts appear instantly; edits and deletes reconcile against the server.
- **Slow by design** — the feed shows **two dispatches per page**, newest first, with "Newer"/"Older" pagination.

### Likes
- **Heart toggle** — idempotent `likePost`/`unlikePost` mutations; the UI updates optimistically and rolls back on error.
- **Floating-heart burst** — liking a post sends a flurry of little hearts drifting up from the button (`post__heart-burst`, ~900 ms).

### Comments — nested threads
- **Unlimited nesting** — replies build a real tree client-side from a flat list; a continuous "spine" connects each reply to its parent, with indentation capped at 5 levels while the underlying structure is preserved.
- **Inline reply composers** — autofocusing, auto-resizing textareas with a 2,000-char counter and ⌘/Ctrl+Enter to submit.
- **Optimistic posting** — pending replies show a "Posting…" state and keep a stable key as they swap to the real record.
- **Armed delete with cascade** — deleting a comment arms a 4-second countdown (Escape cancels) and warns when replies will be removed too; the server cascades the delete across the subtree.

### Profiles
- **`/u/:userId`** — a hero with avatar, name, quoted status, and stats: **Posts**, **Likes received**, and **Joined** (month + year). Follow / Edit-profile are stubbed with "Soon" chips.

### Reading experience
- **Modal-as-route** — clicking a dispatch opens it as an overlay "reader's room" (sticky header, scrollable body, sticky composer dock) over the feed; opening the URL directly or refreshing renders the same post as a full page. Likes and comment counts sync from the modal back into the feed and profile without a refetch.
- **Layout-stable skeletons** — dedicated skeletons for posts, the sidebar, profiles, single-post, and comments mirror the real DOM so nothing shifts as data loads.
- **Native share** — posts offer a share action via `navigator.share` where available.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Backend Framework | Express 4 |
| API | GraphQL (`express-graphql` + `graphql`) |
| Database | MongoDB via Mongoose 8 |
| Authentication | JSON Web Tokens (`jsonwebtoken`) |
| Password Hashing | bcryptjs |
| File Uploads | Multer + `multer-storage-cloudinary` → Cloudinary |
| Validation | `express-validator` / `validator` |
| Frontend | React 16 (Create React App) |
| Routing (Frontend) | React Router v4 |
| Data fetching | Native `fetch` (raw GraphQL, no Apollo/axios) |
| Fonts | Bricolage Grotesque, Plus Jakarta Sans, JetBrains Mono (Google Fonts) |
| Backend Hosting | Render |
| Frontend Hosting | Vercel |

> **Note:** `socket.io` appears in both `package.json` files but is not wired up — there is no real-time layer. Feed updates are optimistic with manual refetch.

---

## Design System

Dispatches ships a hand-authored design system ("design system v2") defined as CSS custom properties in `App/src/index.css`. Components use plain, globally-scoped BEM-ish classes with a co-located `.css` file each (no CSS Modules, no utility framework).

**Type**
- `--font-display` — Bricolage Grotesque (headings, wordmark)
- `--font-body` — Plus Jakarta Sans (body)
- `--font-mono` — JetBrains Mono

**Color tokens**
- Surfaces: `--bg` warm cream `#FAF6EE`, `--surface`, `--surface-2/3`, `--hairline`
- Ink: warm (not pure black) `--ink` `#2A211B` → `--ink-4` `#B5A993`
- Accents: `--clay` terracotta `#C7572A` (primary), `--sage` green, `--heart` `#DB3050` (likes), `--gold`

**Shape, shadow, motion**
- Radii: `--r-xs` → `--r-xl`, `--r-pill`
- Shadows: `--shadow-sm/md/lg/press`
- Easing: `--ease-out`, `--ease-in-out`; keyframes `fade-up`, `pop`, `spin`, `like-pop`

**Primitives** — post cards with an accent rail and hover lift, a hand-rolled 24×24 stroke-SVG icon set (`Icons.js`, `currentColor`), warm gradient avatars, the comment spine, floating-heart burst, and the modal reader's room.

---

## Architecture

### Backend (`Backend/`)

A single Express entry point (`app.js`, port **8080**) wires the request pipeline:

1. `body-parser` JSON parsing
2. Manual CORS middleware (allows all origins, handles `OPTIONS` preflight)
3. **Non-blocking JWT auth** (`middleware/auth.js`) — verifies the `Bearer` token and sets `req.isAuth` / `req.userId`, but never rejects; resolvers enforce authorization themselves
4. Two **REST** multipart upload endpoints (GraphQL can't stream files): `PUT /post-image` (auth-gated, 10 MB) and `POST /avatar-upload` (used pre-login at signup, 5 MB), both via Multer → Cloudinary under `dispatches/<folder>` with uuid public IDs
5. `POST /graphql` (GraphiQL enabled, custom `formatError`)
6. A global error handler that maps Multer failures to `413` / `415`

Everything except image bytes flows through GraphQL. `graphql/schema.js` (`buildSchema`) defines the types; `graphql/resolvers.js` holds the logic, with helpers that project `likeCount` / `likedByMe` / `commentCount` and clean up Cloudinary assets on delete or avatar replacement.

**Models** (`models/`, all with timestamps): `User` (with `posts[]`, `avatarUrl`, `status`), `Post` (with a `likes[]` array and denormalized `commentCount`), and `Comment` — its own collection using an adjacency-list `parent` reference and three compound indexes for thread queries. `deleteComment` walks the subtree (BFS) to cascade.

> `Backend/controllers/` (`auth.js`, `feed.js`) are legacy REST leftovers and are **not** imported by `app.js`. `Backend/seed.js` wipes and repopulates the database with demo accounts, posts, and likes.

### Frontend (`App/`)

React 16 (a mix of class and function components) on Create React App, routed with React Router v4. `App.js` owns the JWT/localStorage session and auto-logout timer, and implements the **modal-as-route** pattern: post links carry `location.state.background`, so the router renders the single post as an overlay over the current page while a direct visit renders it full-page. A versioned `handlePostUpdate` broadcast keeps like and comment counts in sync between the modal, feed, and profile without refetching. The frontend talks to the API with plain `fetch`, POSTing GraphQL query objects.

---

## GraphQL API

Exposed at `POST /graphql`. Authenticated operations require an `Authorization: Bearer <token>` header. GraphiQL is enabled for interactive exploration.

### Queries

| Query | Auth | Description |
|---|---|---|
| `login(email, password)` | No | Returns a JWT token and user ID |
| `getPosts(page)` | Yes | Paginated dispatches (2/page, newest first) + total count |
| `getPost(id)` | Yes | A single dispatch with its comments |
| `getUser(id)` | Yes | A user's profile and their posts |
| `user` | Yes | The current authenticated user |

### Mutations

| Mutation | Auth | Description |
|---|---|---|
| `createUser(userInput)` | No | Registers a new user (optional avatar URL) |
| `createPost(postInput)` | Yes | Creates a dispatch |
| `updatePost(id, postInput)` | Yes (author) | Updates a dispatch |
| `deletePost(id)` | Yes (author) | Deletes a dispatch and its image |
| `updateStatus(status)` | Yes | Updates the current user's status |
| `updateAvatar(avatarUrl)` | Yes | Sets/replaces the current user's avatar |
| `likePost(id)` / `unlikePost(id)` | Yes | Idempotent like toggle |
| `addComment(postId, content, parentId)` | Yes | Adds a comment or (with `parentId`) a reply |
| `deleteComment(id)` | Yes (author) | Deletes a comment and cascades to its replies |

### Image uploads

Images are uploaded over REST before referencing them in a mutation:

```
PUT  /post-image     Content-Type: multipart/form-data   field: image   (auth, ≤10 MB)
POST /avatar-upload  Content-Type: multipart/form-data   field: image   (≤5 MB, used at signup)
```

Each returns a Cloudinary URL to include in the relevant mutation. `PUT /post-image` accepts an `oldPath` to clean up the previous image on edit.

---

## Project Structure

```
Dispatches/
├── Backend/
│   ├── app.js                  # Entry — Express, CORS, auth, upload routes, GraphQL, DB, :8080
│   ├── cloudinary.js           # Cloudinary v2 config
│   ├── seed.js                 # Wipes + reseeds demo users, posts, likes
│   ├── graphql/
│   │   ├── schema.js           # buildSchema types, queries, mutations
│   │   └── resolvers.js        # Resolver logic + post/comment/user projections
│   ├── models/
│   │   ├── user.js             # User (avatar, status, posts[])
│   │   ├── post.js             # Post (likes[], commentCount)
│   │   └── comment.js          # Comment (adjacency-list parent ref, compound indexes)
│   ├── middleware/
│   │   └── auth.js             # Non-blocking JWT → req.isAuth / req.userId
│   ├── controllers/            # Legacy REST leftovers (not wired into app.js)
│   └── images/                 # .gitkeep only — uploads live in Cloudinary
├── App/                        # Create React App frontend
│   └── src/
│       ├── App.js              # Session, routing, modal-as-route, cross-view sync
│       ├── index.css           # Design system tokens (fonts, colors, shadows, motion)
│       ├── pages/
│       │   ├── Auth/           # Login, Signup (with avatar upload)
│       │   ├── Feed/           # Feed + SinglePost (page & modal)
│       │   └── Profile/        # /u/:userId profile
│       ├── components/         # Post, FeedEdit, Comment, Sidebar, Skeleton,
│       │   │                   #   Navigation, Modal, Icons, Logo, Button, …
│       └── util/               # image + validators helpers
└── util/
    └── file.js                 # Shared image cleanup utility
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A [MongoDB](https://www.mongodb.com/atlas) database (Atlas or local)
- A [Cloudinary](https://cloudinary.com/) account for image storage

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/mohamedzeina/dispatches.git
   cd dispatches
   ```

2. **Install backend dependencies:**

   ```bash
   cd Backend
   npm install
   ```

3. **Install frontend dependencies:**

   ```bash
   cd ../App
   npm install --legacy-peer-deps
   ```

4. **Configure environment variables** — see [Environment Variables](#environment-variables).

5. *(Optional)* **Seed demo data:**

   ```bash
   cd Backend
   npm run seed
   ```

6. **Run both servers** (separate terminals):

   ```bash
   # Terminal 1 — Backend (port 8080)
   cd Backend
   npm start

   # Terminal 2 — Frontend (port 3000)
   cd App
   npm start
   ```

7. **Open the app:**
   - Frontend: `http://localhost:3000`
   - GraphiQL: `http://localhost:8080/graphql`

> The frontend currently points at the deployed API URL. To run fully local, update the hardcoded `https://node-social-zmra.onrender.com/graphql` and `/post-image` references in `App/src/` to your local backend.

---

## Environment Variables

The backend reads configuration from a `nodemon.json` file in `Backend/` (gitignored). Create it before starting the server:

```json
{
  "env": {
    "MONGODB_URI": "your-mongodb-connection-string",
    "JWT_SECRET": "a-long-random-secret-string",
    "CLOUDINARY_CLOUD_NAME": "your-cloud-name",
    "CLOUDINARY_API_KEY": "your-api-key",
    "CLOUDINARY_API_SECRET": "your-api-secret"
  }
}
```

| Variable | Description |
|---|---|
| `MONGODB_URI` | Full MongoDB connection string |
| `JWT_SECRET` | Secret used to sign and verify JWTs — keep private |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret — keep private |

---

## Scripts

### Backend (`Backend/`)

| Script | Command | Description |
|---|---|---|
| `npm start` | `nodemon app.js` | Start the API server on port 8080 |
| `npm run seed` | `node seed.js` | Wipe and reseed demo users, posts, and likes |

### Frontend (`App/`)

| Script | Command | Description |
|---|---|---|
| `npm start` | `react-scripts start` | Start the dev server on port 3000 |
| `npm run build` | `react-scripts build` | Production build |
| `npm test` | `react-scripts test` | Run the CRA test runner |
