# QuizApp

A real-time multiplayer quiz app. A host generates a quiz with AI, players
join a room with a code, and everyone answers questions live while a
leaderboard updates in real time.

**Stack:** Next.js (frontend) · Express (backend) · Socket.IO (real-time) ·
PostgreSQL + Prisma (database) · JWT (auth) · Zod (validation) · LLM via
OpenRouter (AI question generation)

```
backend/
  prisma/schema.prisma     # User, Quiz, Question, Room, Participant, Answer
  src/
    routes/                # HTTP endpoints (auth, quiz, rooms)
    services/               # scoringService, roomService, quizService, aiService
    sockets/quizSocket.js   # all Socket.IO event handlers
    middleware/             # authMiddleware, socketAuth, errorHandler
    utils/                  # prisma client, zod schemas for socket payloads
    index.js                # entry point - wires everything together
frontend/
  app/                      # Next.js pages (auth, dashboard, room)
  components/               # Leaderboard, Navbar
  lib/                      # axios client, socket client, current-user hook
```

## Running locally

**Backend**
```bash
cd backend
cp .env.example .env        # fill in DATABASE_URL, JWT_SECRET, OPENROUTER_API_KEY
npm install
npx prisma migrate dev --name init   # first time only - creates migration history
npm run dev
```

**Frontend**
```bash
cd frontend
cp .env.example .env        # NEXT_PUBLIC_BACKEND_URL=http://localhost:5000
npm install
npm run dev
```

**Backend in Docker** (frontend is not containerized - run it with `npm run dev` as above)
```bash
docker compose up --build
```
See the comments at the top of `docker-compose.yml` for the one-time setup
this needs (env file, and why it uses `prisma db push` instead of
`migrate deploy` until you've created a real migration history).

---

# C-DOT Interview Guide

## A. 60-second project explanation

"I built a real-time multiplayer quiz app - think Kahoot. A host picks a
topic, an LLM generates multiple-choice questions, and the app stores them
in Postgres. The host creates a room and shares a 6-letter code. Players
join over HTTP, then open a WebSocket connection so everyone sees the same
question at the same time. When someone answers, the answer goes to the
backend over the socket - the server checks it's correct, works out how
long they took, awards points, and updates a live leaderboard for
everyone. The backend is the single source of truth for correctness,
timing, and scoring; the frontend just displays state. The whole thing is
Next.js talking to an Express + Socket.IO backend, backed by Postgres
through Prisma, with JWT auth in HttpOnly cookies."

## B. Architecture explanation

- **Next.js (frontend):** React framework with file-based routing (`app/`
  directory). Renders the login/signup page, a dashboard to generate a
  quiz, and the live room page. All client components (`"use client"`)
  since they need browser APIs (WebSocket, localStorage-free cookie auth).
- **Express (backend):** Handles stateless HTTP requests - signup/signin,
  quiz generation, room creation/joining. Also hosts the same HTTP server
  that Socket.IO attaches to.
- **Socket.IO:** A library built on WebSocket (falling back to HTTP
  long-polling if WebSocket isn't available) that adds automatic
  reconnection, "rooms" (broadcast groups - one per quiz room code), and
  structured event names instead of raw messages.
- **PostgreSQL:** The relational database holding every persistent
  entity - users, quizzes, questions, rooms, participants, answers.
- **Prisma:** Type-safe ORM/query builder. `schema.prisma` defines the
  models; Prisma generates a client with methods like
  `prisma.participant.update(...)` instead of hand-written SQL, and
  `$transaction` for atomic multi-step writes.
- **JWT:** A signed token containing `{ userId }`, stored in an HttpOnly
  cookie so client-side JS can't read it (mitigates XSS token theft). Sent
  automatically by the browser on every request/socket handshake.
- **Zod:** Schema validation library. Every HTTP body and socket payload
  is parsed against a Zod schema before it touches business logic, so
  malformed input is rejected early with a clear error instead of causing
  a confusing failure three layers down.
- **LLM (via OpenRouter):** Generates candidate quiz questions from a
  topic/difficulty prompt. The backend never trusts this output directly -
  it's validated and normalized before being stored (see section F/I).

## C. End-to-end flow

1. **Login** - `POST /api/auth/signin` verifies the password with bcrypt,
   signs a JWT, sets it as an HttpOnly cookie.
2. **Quiz generation** - `POST /api/quiz/generate` calls the LLM, validates
   every returned question with Zod, resolves each correct answer to an
   option index (rejecting the question if it can't), and stores the quiz.
3. **Room creation** - `POST /api/rooms/create` generates a unique 6-letter
   code and a `Room` row pointing at that quiz, with the creator as host.
4. **Players join** - `POST /api/rooms/join/:code` creates a `Participant`
   row (the *only* place that happens) after checking room capacity.
5. **WebSocket connection** - the client calls `socket.connect()` (JWT
   cookie attached automatically) and emits `join-room`, which just joins
   the Socket.IO room for that code and sends back the current leaderboard
   / in-progress question if the quiz is already running.
6. **Quiz starts** - host emits `start-quiz`; server checks they're really
   the host, creates in-memory room state, and broadcasts the first
   question plus starts the one authoritative reveal timer.
7. **Answer submission** - a player emits `submit-answer`; server verifies
   the participant, verifies the question is still the room's current
   one, computes elapsed time itself, scores it, and atomically stores the
   `Answer` + increments the `Participant.score` in one transaction.
8. **Scoring** - handled entirely server-side (section F).
9. **Leaderboard** - after every answer, the server re-reads participants
   for that room sorted by score and broadcasts it to everyone.
10. **Quiz completion** - once `next-question` pushes the index past the
    last question, the server marks the room `finished` in Postgres,
    deletes its in-memory state, and broadcasts `quiz-completed`.

## D. Why WebSocket / Socket.IO?

HTTP is request-response: the client asks, the server answers, the
connection is done. For a live leaderboard or "everyone sees the new
question at the same instant," HTTP would mean the client has to keep
polling ("has anything changed yet?"), which is wasteful and laggy.
WebSocket opens one persistent, full-duplex TCP connection - either side
can push a message at any time with no new handshake. That's exactly what
a live quiz needs: the server pushes "new question" and "leaderboard
updated" to every connected player the moment they happen. Socket.IO
sits on top of raw WebSocket and adds: automatic reconnection, fallback to
HTTP long-polling for networks that block WebSocket, and "rooms" - a
built-in way to broadcast to only the sockets in one quiz room code
instead of every connected client.

## E. Database design

- **User** - id, email (unique), username, hashed password. One user can
  own many quizzes and be a participant in many rooms.
- **Quiz** - a generated set of questions: topic, difficulty, timeLimit
  (seconds per question), owned by the user who generated it.
- **Question** - belongs to a Quiz; stores the question text, an options
  array (stored as `Json`), the correct option's index, and an
  explanation.
- **Room** - a live/finished session of a Quiz: a unique 6-letter `code`
  players join with, `hostId` (who controls it), `status`
  (waiting/active/finished), `maxPlayers`.
- **Participant** - a (User, Room) pairing with a running `score`.
  `@@unique([userId, roomId])` guarantees one user can't join the same
  room twice as two separate participants.
- **Answer** - one row per (Participant, Question) submission:
  `selectedAnswer`, `isCorrect`, `points`, `answeredAt`.
  `@@unique([participantId, questionId])` is what actually stops someone
  answering the same question twice - enforced by Postgres itself, not
  just a JavaScript check.

Foreign keys tie Question→Quiz, Room→Quiz, Participant→User/Room,
Answer→Participant/Question. Indexes exist on the foreign-key-heavy
lookup paths (`Question.quizId`, `Participant.roomId`, `Answer.questionId`)
since those are exactly the columns queried when building a leaderboard or
loading a quiz's questions.

## F. Concurrency

- **Simultaneous answer submissions:** many players can emit
  `submit-answer` within the same millisecond. Each submission is handled
  independently and its score update uses `{ increment: points }` rather
  than "read score, add in JS, write score" - the increment is translated
  to a single `UPDATE ... SET score = score + $1` SQL statement, which
  Postgres executes atomically. Two concurrent increments can never
  overwrite each other because neither ever reads the other's
  intermediate value.
- **Transaction:** creating the `Answer` row and incrementing the score
  are wrapped in `prisma.$transaction([...])` - either both happen or
  neither does. Without this, a crash between the two writes could leave
  a scored answer that never actually incremented the leaderboard, or
  vice versa.
- **Isolation / race condition this fixes:** the *original* bug this
  project had was `submit-answer` scheduling its own `setTimeout` to
  auto-advance the question, while `start-quiz` scheduled a separate
  30-second reveal timer - two independent timers that could both fire
  and mutate the same room state, sometimes advancing twice or reading a
  question index that had already moved. The fix: exactly one timer per
  room (`roomService`'s `revealTimer`), always cleared before a new one is
  scheduled, and the *only* place `currentQuestionIndex` changes is the
  host's `next-question` handler - which the server now additionally
  **rejects outright** while an explicit `state.revealed` flag is
  `false`. That flag starts `false` when a question broadcasts and is
  flipped to `true` by exactly one place: the reveal timer's callback.
  There is no code path where the host (or anyone) can advance early -
  the question must actually time out server-side first.
- **Late/duplicate answer prevention:** three layers, not one - (1) the
  socket handler checks the submitted `questionId` still matches the
  room's current question, (2) it checks `state.revealed` and the
  server-measured `elapsedMs` against the quiz's time limit and rejects
  anything submitted after the window closed (the client's own countdown
  is display-only and is never trusted for this), and (3) the database's
  `@@unique([participantId, questionId])` constraint rejects a second
  `Answer` row outright regardless of what the application layer
  checked. The handler catches that specific Prisma error (`P2002`) and
  replies with a clean "already answered" message instead of crashing
  the socket server.
- **Room-join capacity race:** "count participants, then insert if under
  capacity" has a race window - two join requests can both count N
  (under the limit) before either inserts, overshooting `maxPlayers`.
  Fixed without Redis or an app-level lock: `routes/room.js` wraps the
  count-and-insert in `prisma.$transaction` and takes a Postgres
  row-level lock first (`SELECT ... FOR UPDATE` on that specific `Room`
  row). A second concurrent join for the *same* room simply blocks at
  that line until the first transaction commits, so the count it then
  sees is always accurate. Joins to different rooms lock different rows
  and don't block each other at all.
- **DBMS transactions / ACID**, if asked generally: Atomicity (the answer
  transaction is all-or-nothing), Consistency (constraints like the
  unique index are never violated), Isolation (concurrent transactions
  don't see each other's uncommitted writes - Postgres's default `READ
  COMMITTED` is enough here since we rely on atomic increments, a unique
  constraint, and one explicit row lock rather than unprotected
  read-then-write logic), Durability (once committed, a crash right
  after doesn't lose the write).

## G. Security

- **Password hashing:** bcrypt with a salt round of 10 - passwords are
  never stored or compared in plaintext; even if the database leaked, the
  hashes are computationally expensive to reverse.
- **JWT:** short-lived (15 minutes), signed with a server-only secret,
  stored in an `httpOnly` cookie so client-side JavaScript (and therefore
  a successful XSS payload) can't read or exfiltrate it. `sameSite: "lax"`
  limits it being sent on cross-site requests; `secure: true` in
  production restricts it to HTTPS.
- **Authorization vs authentication:** authentication (verifying the JWT,
  populating `req.userId` / `socket.userId`) happens once in shared
  middleware. Authorization (e.g. "only the host can start the quiz") is
  checked per-action against the database's `hostId`, never inferred from
  what the frontend chose to show or hide.
- **Server-authoritative scoring:** the client never sends "I got this
  right" or "it took me 3 seconds" - it sends only its selected option
  index, and the server independently determines correctness and elapsed
  time. A modified client can't cheat the leaderboard.
- **Input validation:** every HTTP body and socket payload passes through
  a Zod schema before reaching any business logic or database query,
  rejecting malformed types/shapes up front.
- **Error handling:** raw database/internal error messages are never sent
  to the client - they're logged server-side and replaced with a generic,
  safe message.

## H. Scalability discussion

**Current:** a single Node.js process holds all *active* game state
(current question index, question start time, reveal timer) in a plain
in-memory `Map`. Postgres is the single source of truth for everything
persistent. This is simple, fast (no network hop to check "what question
are we on"), and completely honest about its limit: it only works with
exactly one backend instance. If you ran two instances behind a load
balancer, a room's live state would only exist on whichever instance
happened to handle that room's `start-quiz` call - the other instance
would have no idea a quiz was running.

**Future (not implemented - deliberately, for this project):** to run
multiple backend instances you'd need to (1) move Socket.IO's
room-broadcast layer onto a shared adapter (Socket.IO's official Redis
adapter is the standard choice) so an event emitted on instance A reaches
sockets connected to instance B, and (2) move the active-game-state `Map`
into something shared (Redis again, or a sticky-session + room-to-instance
routing scheme) so any instance can find or take over a room's state.
That's a deliberate scope decision, not an oversight - it would add Redis,
extra failure modes, and cross-instance race conditions to explain for
very little benefit in a project that will never actually run at that
scale.

## I. C-DOT-style questions

**Networking / Sockets / TCP / HTTP**

1. **Q: What's the difference between TCP and UDP, and which does
   WebSocket use?**
   A: TCP is connection-oriented, ordered, and reliable (retransmits lost
   packets); UDP is connectionless and unreliable but lower-latency.
   WebSocket is built on top of a single TCP connection.

2. **Q: How does a WebSocket connection get established?**
   A: It starts as a normal HTTP request with an `Upgrade: websocket`
   header; if the server agrees, it replies `101 Switching Protocols` and
   the same TCP connection is reused for full-duplex WebSocket frames
   instead of new HTTP requests.

3. **Q: Why not just poll a REST endpoint every second instead of using
   WebSocket?**
   A: Polling means a new TCP handshake (or at least a new HTTP
   request/response) every interval, wasted requests when nothing
   changed, and up to one full interval of latency before the client
   learns something happened. WebSocket pushes the moment the server has
   something to say, over one already-open connection.

4. **Q: What port does Postgres use by default, and does that matter for
   this project's Docker setup?**
   A: 5432. In `docker-compose.yml` the `postgres` service exposes 5432,
   and the backend container reaches it via the service name `postgres`
   as a hostname (Docker's internal DNS), not `localhost`.

5. **Q: Socket.IO says it "falls back to HTTP long-polling." What does
   that mean?**
   A: If a WebSocket upgrade fails (e.g. a proxy blocks it), Socket.IO
   keeps working by having the client repeatedly issue HTTP requests that
   the server holds open until there's data to return - functionally
   similar to WebSocket but built out of HTTP requests instead of one
   persistent connection.

6. **Q: What is CORS and where does this project configure it?**
   A: Cross-Origin Resource Sharing - a browser restriction that blocks a
   page on one origin from reading responses from another origin unless
   the server opts in via `Access-Control-Allow-*` headers. Configured in
   `index.js` for both Express (`cors({ origin: FRONTEND_URL, credentials:
   true })`) and Socket.IO's own `cors` option, since they're separate
   HTTP surfaces.

7. **Q: Why does `credentials: true` matter here specifically?**
   A: The JWT is an HttpOnly cookie. Cookies are only sent cross-origin if
   both the request (`withCredentials: true` in Axios/Socket.IO client)
   and the response (`credentials: true` in CORS config) opt in.

8. **Q: What's a socket "room" in Socket.IO, and is it related to a TCP
   connection?**
   A: It's a Socket.IO-level grouping (`socket.join(code)`) used to
   broadcast to a subset of connected sockets (`io.to(code).emit(...)`).
   It has nothing to do with TCP - it's purely an in-process bookkeeping
   concept inside the Socket.IO server.

9. **Q: What HTTP status codes does this API use, and why?**
   A: 200/201 for success, 400 for validation errors, 401 for missing/
   invalid auth, 404 for not-found resources, 500 for unexpected server
   errors, 502 when the upstream LLM call fails/returns something unusable.

10. **Q: How does the client know its WebSocket disconnected, and what
    happens to its data?**
    A: Socket.IO fires a `disconnect` event and automatically attempts
    reconnection. No client-side state is trusted for anything that
    matters (score, correctness) - on reconnect the client re-emits
    `join-room` and the server resends the current question/leaderboard
    from its own state, so nothing is lost even though the TCP connection
    was.

**OS / Concurrency**

11. **Q: What's a race condition, and where was one in this project
    before the refactor?**
    A: A race condition is when the correctness of a result depends on
    the unpredictable timing/interleaving of concurrent operations. Here,
    two independent `setTimeout` timers (one from `start-quiz`, one
    scheduled inside `submit-answer`) could both fire and mutate the same
    room's question index, sometimes double-advancing or acting on a
    question that had already changed.

12. **Q: How did you fix it?**
    A: Reduced it to exactly one timer per room, stored in that room's
    state object, always cleared (`clearTimeout`) before a new one is
    scheduled. On top of that, I added an explicit `revealed` boolean to
    the room's state - `false` when a question starts, and the *only*
    place it ever becomes `true` is that one timer's callback. The
    host's `next-question` handler checks it and rejects the request
    outright while it's `false`, so there is no code path - host
    included - that can skip or double-advance a question early.

13. **Q: What's the difference between concurrency and parallelism?**
    A: Concurrency is structuring a program to handle multiple things
    that overlap in time (not necessarily executing simultaneously);
    parallelism is actually running things at the same instant on
    multiple cores. Node.js is single-threaded for JS execution -
    concurrent I/O (DB queries, socket events) is handled via the event
    loop and async callbacks, not true parallel threads.

14. **Q: If Node.js is single-threaded, how can it handle many concurrent
    `submit-answer` events?**
    A: The event loop processes one callback at a time, but I/O
    operations (like a Prisma query hitting Postgres) are non-blocking -
    Node hands them off and moves on to the next event, resuming each
    handler's `await` when its result comes back. So many requests are
    *in flight* concurrently even though JS itself never executes two
    callbacks literally simultaneously.

15. **Q: Why use an atomic `increment` instead of reading the score, adding
    in JavaScript, and writing it back?**
    A: Read-modify-write in application code has a gap between the read
    and the write. If two answers for the same participant arrived close
    together (edge case, but a general pattern worth knowing), both could
    read the same starting score, add their own points, and the second
    write would overwrite the first - losing points. `{ increment: n }`
    becomes a single atomic SQL `UPDATE ... SET score = score + n`, so
    there's no window for that to happen.

16. **Q: What is a mutex/lock, and did this project need one?**
    A: A lock is a primitive that lets only one thread/process hold
    exclusive access to a resource at a time. This project didn't need an
    application-level lock because Postgres's atomic increment and unique
    constraint already provide the safety needed - reaching for a
    distributed lock here would be solving a problem the database already
    solves.

17. **Q: What's a deadlock?**
    A: Two or more operations each waiting on a resource the other holds,
    so neither can proceed. Not really a risk in this project's write
    pattern since each transaction touches a small, consistent set of
    rows in the same order.

**DBMS**

18. **Q: What does `@@unique([participantId, questionId])` actually
    enforce, and why is that important here?**
    A: A composite unique index in Postgres - no two rows can have the
    same `(participantId, questionId)` pair. It's the real enforcement
    mechanism against duplicate answers; the application-level check
    ("is this still the current question") is a fast-path optimization,
    but the database guarantees correctness even if that check were
    somehow bypassed or raced.

19. **Q: What are the ACID properties?**
    A: Atomicity, Consistency, Isolation, Durability - see section F for
    how each applies to the answer-submission transaction specifically.

20. **Q: What is a database transaction, and why is `$transaction` used
    for answer submission?**
    A: A transaction groups multiple statements so they commit or roll
    back together. Here it groups "create the Answer row" and "increment
    the Participant's score" - without it, a crash between the two writes
    could store a scored answer that was never reflected in the
    leaderboard.

21. **Q: What's a foreign key, and name one in this schema.**
    A: A column that must reference an existing row in another table,
    enforced by the database. Example: `Participant.roomId` references
    `Room.id` - you can't create a Participant pointing at a Room that
    doesn't exist.

22. **Q: What's an index, and why was one added on `Answer.questionId`?**
    A: A data structure (typically a B-tree in Postgres) that lets the
    database find matching rows without scanning the whole table. It was
    added because a common query pattern is "how many/which answers exist
    for this question" - without an index that's a full table scan as the
    Answer table grows.

23. **Q: What's the difference between `@@unique` and `@@index` in
    Prisma?**
    A: `@@unique` both creates an index *and* enforces that no two rows
    can share those column values - a constraint. `@@index` only speeds
    up lookups; it doesn't restrict what can be inserted.

24. **Q: What isolation level does this project rely on, and why is that
    enough?**
    A: Postgres's default, `READ COMMITTED`. It's sufficient here because
    the concurrency safety doesn't come from reading a value and assuming
    it stays fresh (which would need a stricter level like
    `SERIALIZABLE`) - it comes from atomic increments and a unique
    constraint, both of which are safe under `READ COMMITTED`.

25. **Q: Why store `options` as `Json` instead of a separate `Option`
    table?**
    A: Options are always read and written as a whole with their
    question, never queried individually ("find all options containing
    X" isn't a use case here), so normalizing them into their own table
    would add join overhead for no query benefit. `Json` keeps it simple
    for a bounded, always-together list.

**Authentication / System design**

26. **Q: Why store the JWT in a cookie instead of `localStorage`?**
    A: `localStorage` is readable by any JavaScript running on the page,
    so an XSS vulnerability anywhere in the app would let an attacker
    steal the token directly. An `httpOnly` cookie can't be read by
    JavaScript at all - the browser attaches it automatically, but
    injected script can't exfiltrate it.

27. **Q: What would you change to make this horizontally scalable?**
    A: Move Socket.IO onto a shared adapter (Redis pub/sub is the
    standard) so events broadcast from one instance reach clients
    connected to another, and move the active in-memory room state
    (currently a plain `Map`) into shared storage so any instance can
    serve any room. See section H.

28. **Q: Why is quiz-answer validation done server-side instead of trusting
    the client's "correct: true/false"?**
    A: The client is fully controlled by the user - any value it sends
    can be forged with browser devtools. Only the server has a trusted
    copy of the correct answer and a trusted clock, so it must be the one
    to decide correctness and elapsed time.

29. **Q: How does this project prevent an AI-generated question with a
    broken "correct answer" from silently corrupting a quiz?**
    A: `quizService` tries to resolve the AI's stated answer (numeric
    index, numeric string, letter, or matching option text) to a real
    option index; if none of those resolve to a valid index, that
    question is rejected outright rather than defaulting to option 0 -
    which would otherwise silently score every participant against the
    wrong answer.

30. **Q: Walk through what happens if two players click the same answer
    at literally the same moment.**
    A: Both `submit-answer` events are handled independently (Node
    processes them as separate async callbacks). Each does its own
    participant lookup, its own elapsed-time calculation from the shared
    `questionStartTime`, and its own transaction. There's no shared
    mutable state between the two beyond the database itself, and the
    database's atomic increment plus unique constraint make each
    transaction safe regardless of interleaving - so both are scored
    correctly and independently, and neither can create a duplicate
    Answer row for the same participant.

31. **Q: What's the purpose of `postinstall: "prisma generate"` in
    `package.json`?**
    A: Prisma's client (`@prisma/client`) is generated code based on
    `schema.prisma` - it doesn't ship pre-built for an arbitrary schema.
    Running `prisma generate` after every `npm install` guarantees the
    generated client always matches the current schema, including inside
    the Docker image build.

32. **Q: In the Dockerfile, why is `prisma/` copied into the image before
    running `npm ci`, instead of after?**
    A: `npm ci` triggers the `postinstall` script (`prisma generate`),
    which reads `prisma/schema.prisma`. If that file isn't in the build
    context yet when `npm ci` runs, the generate step fails - so the
    schema has to be copied in first.

33. **Q: Why keep an explicit `revealed` boolean instead of just checking
    "has the timer fired"?**
    A: There's no direct way to ask a `setTimeout` handle "have you fired
    yet" - you can only be notified via its callback. Storing `revealed`
    as an explicit field means any handler (`submit-answer`,
    `next-question`, a reconnecting `join-room`) can synchronously check
    the room's current phase without needing access to the timer object
    itself, and it makes the state machine's phase visible in one place
    instead of being implicit in whether a callback has run.

34. **Q: Why does `submit-answer` check both `state.revealed` and the
    elapsed time, instead of just one of them?**
    A: They're the same underlying rule (the answering window has
    closed) checked two different ways. `elapsedMs > timeLimitMs` is the
    literal, timestamp-based server-authoritative check. `state.revealed`
    is a cheap synchronous flag that also covers the sliver of time
    between the timer firing and this specific request being processed.
    Neither is redundant to remove - one is the source of truth, the
    other is a fast guard for the moment right around the boundary.

35. **Q: Why doesn't `answer-result` include the correct answer?**
    A: If it did, a curious player could open devtools, watch the socket
    traffic, submit any answer, and read the correct one off their own
    private acknowledgement - instantly, regardless of the 30-second
    window everyone else is still working within. The correct answer is
    only ever broadcast once, via `reveal-answer`, after the server's own
    timer confirms the window is closed for everyone at once.

36. **Q: Walk through the room-capacity fix - why not just check
    `count < maxPlayers` right before the `create`?**
    A: That's exactly the race: "check, then act" has a gap where another
    request can slip in between the check and the write. Two joins can
    both read a count of, say, 4 out of a 5-player cap, both decide
    they're clear, and both insert - now the room has 6. The fix wraps
    the whole read-then-write in one Postgres transaction and takes a row
    lock (`SELECT ... FOR UPDATE`) on that room first, so a second
    concurrent join to the same room can't even read the count until the
    first join's transaction has fully committed (or failed).

37. **Q: What's the difference between `SELECT ... FOR UPDATE` and just
    using Prisma's `$transaction` array syntax (like the answer-submission
    transaction uses)?**
    A: The array form (`prisma.$transaction([opA, opB])`) batches
    independent operations to commit-or-rollback together, but doesn't by
    itself stop two separate transactions from interleaving on the *same*
    row. The interactive form (`prisma.$transaction(async (tx) => {...})`)
    lets you run a raw `FOR UPDATE` statement first, which takes a lock
    that forces a second transaction touching the same row to wait - that
    ordering guarantee is what the capacity check specifically needs and
    the array form doesn't provide on its own.

---

# Change Summary

## 1. Files changed
- `backend/src/index.js` - reduced from ~400 lines of mixed HTTP+socket
  logic to a thin entry point that wires routes, middleware, and sockets
  together.
- `backend/src/routes/auth.js` - removed Redis caching from `/me`; added
  a signin Zod schema; stopped leaking raw error messages.
- `backend/src/routes/quiz.js` - moved AI-output validation/normalization
  into `services/quizService.js`; removed the unused, unsafe
  `POST /:quizId/submit` endpoint.
- `backend/src/routes/room.js` - participant lookup now uses the unique
  `(userId, roomId)` key instead of `findFirst`; consistent error
  responses.
- `backend/prisma/schema.prisma` - added the `Answer` model and relations;
  added indexes on `Question.quizId`, `Participant.roomId`,
  `Answer.questionId`.
- `backend/package.json` - fixed `main`/`scripts` to point at `src/index.js`
  (was pointing at a non-existent root `index.js`); removed `ioredis`,
  `@google/generative-ai`, `socket.io-client`; added `postinstall: prisma
  generate`.
- `backend/.env.example` / `.env` - removed unused `REDIS_URL`,
  `GEMINI_API_KEY`.
- `frontend/app/room/[code]/page.tsx` - rewritten against the new,
  smaller socket event contract; removed difficulty/add-questions
  controls, sound effects, and client-sent `timeElapsed`.
- `frontend/components/Leaderboard.tsx` - rewritten without
  `framer-motion`.
- `frontend/package.json` - removed unused `framer-motion`, `zustand`.

## 2. What was removed
- Redis entirely (cache layer, dependency, env vars, config file).
- `change-difficulty` and `add-questions` socket events and their UI.
- The dead/unused `POST /api/quiz/:quizId/submit` HTTP endpoint (client
  never called it, and it trusted client-provided correctness).
- The per-answer `setTimeout` inside `submit-answer` that used to
  auto-advance the question.
- `frontend/test.html` (a stray manual socket test page with hardcoded
  IDs, not part of the app).
- Unused default Next.js boilerplate SVGs in `frontend/public/`.
- `framer-motion`, `zustand`, `ioredis`, `@google/generative-ai`,
  `socket.io-client` (backend) - all unused dependencies.

## 3. What was added
- `Answer` Prisma model with `@@unique([participantId, questionId])`.
- `services/scoringService.js`, `services/roomService.js`,
  `services/quizService.js`.
- `sockets/quizSocket.js`, `middleware/socketAuth.js`,
  `middleware/errorHandler.js`, `utils/validation.js`.
- `backend/Dockerfile`, `backend/.dockerignore`, root `docker-compose.yml`
  (backend + Postgres only, per your request - frontend is not
  containerized).
- This README's C-DOT Interview Guide.

## 4. Bugs fixed
- **Dual-timer race condition:** two independent timers could both mutate
  the same room's question index; now there's exactly one reveal timer
  per room, always cleared before rescheduling, and only `next-question`
  advances the index.
- **Client-trusted timing/score:** the client used to send `timeElapsed`,
  which the server trusted for scoring. The server now measures elapsed
  time itself from a stored `questionStartTime`.
- **Silent AI answer-index fallback:** an AI question whose correct answer
  couldn't be resolved used to default to index `0`, silently scoring
  everyone against a wrong answer. It's now rejected with an error.
- **`package.json` main/scripts pointed at a non-existent `index.js`**
  (the real file was `src/index.js`) - `npm start`/`npm run dev` from a
  clean checkout would have failed.
- **Duplicate-participant race:** room join used `findFirst` +
  conditional `create`, which has a race window between the two; it now
  looks up by the actual unique key.
- **No duplicate-answer protection at the database level:** previously
  only implicit; now enforced by a real unique constraint plus graceful
  handling of the resulting Prisma error.

## 5. Architectural decisions
- Kept the stack exactly as specified (Next.js/Express/Socket.IO/
  Postgres/Prisma/JWT/Zod/LLM) - no Redis, no microservices, no message
  queue.
- Active game state stays in a single in-memory `Map` per the existing
  architecture, with the scaling limitation stated explicitly in code
  comments and in this README rather than hidden.
- Socket event surface reduced to six client-facing events (`join-room`,
  `start-quiz`, `submit-answer`, `next-question`, `leave-room`, plus
  Socket.IO's built-in `disconnect`) and six server-broadcast events
  (`question`, `reveal-answer`, `answer-result`, `leaderboard-update`,
  `quiz-completed`, `error`).
- Docker added for the backend only, as requested; the frontend continues
  to run with `next dev`/deploy separately.

## 6. Commands run to verify
This sandbox has **no network access** (the npm registry and Docker are
both blocked here), so I could not run `npm install`, `prisma generate`/
`migrate`, a real `next build`, or `docker build`. What I *did* run and
verify:
- `node --check` on every backend `.js` file - all pass (syntax-valid).
- `tsc --noEmit` (a locally available TypeScript compiler) against every
  edited/created frontend `.ts`/`.tsx` file, filtering out the expected
  "cannot find module" errors caused by `node_modules` not being
  installed here - no real syntax/type errors found.
- `python3 -c "import yaml; yaml.safe_load(...)"` against
  `docker-compose.yml` - valid YAML.
- Manually re-read the full diff of every changed file for consistency
  (event names, field names, removed-feature references) via `grep`
  sweeps across the whole repo.

**You should run, before trusting this in an interview demo:**
```bash
cd backend && npm install && npx prisma validate && npx prisma migrate dev --name init
cd frontend && npm install && npm run build
docker compose build backend   # optional, if you want to confirm the image builds
```
I removed both `package-lock.json` files because they referenced
dependencies I deleted (`ioredis`, `framer-motion`, `zustand`) and would
make `npm ci` fail as-is; `npm install` will regenerate clean ones.

---

## Update log: strict reveal flow + dashboard split

A second round of changes on top of the above:

**1. Dashboard split into Create Room / Join Room.**
`frontend/app/dashboard/page.tsx` now opens on a choice screen; the
existing AI quiz-generation flow moved under "Create Room" unchanged,
and a new "Join Room" flow lets a player type a code, validates it via
`POST /api/rooms/join/:code` right there (so a bad code or full room
shows an inline error before navigating anywhere), then routes to
`/room/:code`.

**2-6. Strict question -> answer -> reveal -> next-question flow.**
- Added an explicit `revealed` boolean to each room's in-memory state
  (`roomService.js`), `false` when a question starts, flipped to `true`
  by the ONE authoritative reveal timer and nothing else.
- `next-question` now **rejects** the request (host included) while
  `state.revealed` is `false` - there is no server-side path to skip a
  question early anymore. Previously the host could force an early
  reveal+advance; that path is now gone entirely.
- `submit-answer` rejects any submission once `state.revealed` is `true`
  *or* once server-measured elapsed time exceeds the quiz's time limit -
  whichever the socket sees first. The client's own countdown remains
  display-only.
- `answer-result` (the private per-submitter acknowledgement) no longer
  includes `correctAnswer` - only `{ correct, points }`. The correct
  answer is now revealed to everyone exclusively through the
  `reveal-answer` broadcast once the timer fires.
- `join-room` (reconnection) now also emits `reveal-answer` to a
  reconnecting client if the current question was already revealed
  before they (re)connected, so they see the real correct answer instead
  of an indefinite "waiting" state.
- Frontend (`app/room/[code]/page.tsx`) mirrors this with its own
  `revealed` state: resets on every new question, set by the
  `reveal-answer` event, and gates both answer submission and the "Next
  Question" button (disabled + relabeled "Waiting for reveal..." until
  then). This is a UI convenience only - the server enforces all of the
  above independently either way.

**8. Room-join capacity race fixed.**
`routes/room.js`'s join handler used to `count()` then conditionally
`create()` - two concurrent joins could both pass the count check before
either inserted, overshooting `maxPlayers`. Fixed with a Postgres
row-level lock (`SELECT ... FROM "Room" ... FOR UPDATE`) taken inside a
Prisma interactive `$transaction`, so a second concurrent join to the
same room blocks until the first one's transaction resolves. No Redis or
application-level lock was added - Postgres's own row locking does the
whole job.

**`prisma.config.ts` updated** to use Prisma's `env()` helper (matching
what you provided) instead of `process.env["DATABASE_URL"]` directly.

**Verification method unchanged from before** - same sandbox, still no
network access, so this round of changes was verified the same way:
`node --check` on every touched backend file, a filtered `tsc --noEmit`
pass on every touched frontend file, and a full-repo `grep` sweep
confirming `correctAnswer` never appears in an `answer-result` emit and
that `revealed` is checked everywhere it needs to be. Run
`npx prisma migrate dev` and `npm run build` yourself before an actual
interview demo, same caveat as before.
