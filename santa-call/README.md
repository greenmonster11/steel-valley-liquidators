# Call Santa 🎅

Live, real-time video calls with an AI Santa, for classrooms and families.

A teacher or parent fills in a short setup: the class or family, what they've been up to, and each child's first name with a fact or two. Santa then talks with the kids live. He greets them by name, brings up what "the elves told him," asks what they're hoping for, and never promises a present. A helper panel that only the adult sees lets them tell Santa who's up next, nudge him ("tell a joke", "time to wrap up"), and get a quiet alert if a child says something worrying.

![Santa on a call](docs/call.jpg)

| Setup (stays on your device) | Helper panel (only the grown-up sees it) |
| --- | --- |
| ![Setup page](docs/setup.jpg) | ![Helper panel](docs/helper.jpg) |

## Try it in 1 minute (demo mode, no keys)

```bash
cd santa-call
npm install
npm start
# open http://localhost:8787
```

With no AI configured, the app runs in **demo mode**. Santa hums canned lines instead of talking, but everything else is real: the setup page, the animated Santa with lip-sync, captions, the helper panel, hold-to-talk, and hang-up. Click **Fill in an example** on the setup page to see it with a sample class.

## Connect the real AI Santa

Santa's brain and voice come from **Gemini Live** (`gemini-3.8-live`, released Sept 15, 2026). It's a speech-to-speech model: kids' audio goes in and Santa's voice comes straight back out, with no separate speech-to-text or text-to-speech step. That's why replies feel quick and conversational.

### ⚠️ Pick the right Google backend

| Backend | Allowed with kids? | Use it for |
| --- | --- | --- |
| **Vertex AI** (Google Cloud) | Google Cloud's terms don't have the under-18 ban, but *you* must follow child-privacy law (see below). | **Real calls with kids** |
| **Gemini Developer API** (AI Studio key) | **No.** Its [terms](https://ai.google.dev/gemini-api/terms) forbid apps "directed towards or likely to be accessed by individuals under the age of 18." | Trying it out yourself, as an adult |

### Vertex AI (recommended)

1. Create or pick a Google Cloud project and enable the **Vertex AI API**.
2. Sign in so the server can use your credentials:
   ```bash
   gcloud auth application-default login
   ```
   When hosting, use a service account with the *Vertex AI User* role instead.
3. Create `santa-call/.env`:
   ```bash
   GOOGLE_CLOUD_PROJECT=your-project-id
   GOOGLE_CLOUD_LOCATION=us-central1
   ```
4. `npm start`. The console shows `Backend: vertex · model: gemini-3.8-live`.

If Google renames the model, set `SANTA_MODEL` to the Live model ID shown in your Cloud console.

### Gemini API key (adult testing only)

```bash
GEMINI_API_KEY=your-key   # in .env
```

The setup page shows a warning banner while this backend is active.

## How it works

```mermaid
flowchart LR
  subgraph Browser["Browser (teacher's laptop)"]
    Mic["Mic → 16 kHz PCM"]
    Helper["Helper panel"]
    Avatar["Animated Santa + captions"]
  end
  Server["Node server<br/>builds Santa's instructions<br/>holds credentials · relays"]
  Gemini["Gemini Live<br/>speech in → speech out"]
  Mic -- "kids' audio" --> Server
  Helper -- "who's next, nudges" --> Server
  Server -- "audio + instructions" --> Gemini
  Gemini -- "Santa's voice, transcripts, alerts" --> Server
  Server -- "24 kHz voice, captions, alerts" --> Avatar
```

- **The setup never leaves the browser until the call starts.** It's saved in `localStorage`. Use **Download setup** to carry it to another computer.
- **The server keeps credentials and Santa's instructions** (`shared/santa-prompt.js`) out of the browser. It saves nothing to disk.
- **Turn-taking.** In hands-free mode, Gemini's voice detection decides when a child is done. It's tuned to wait a bit longer, since kids pause mid-sentence. In a classroom, the mic is muted while Santa talks, so he doesn't hear himself through the speakers. Hold-to-talk hands the decision to the adult: hold the space bar while a child speaks.
- **Stage directions.** The helper panel sends notes like *"Emma is stepping up to talk to you now."* Santa acts on them but never reads them aloud. This is how he knows which child is in front of the camera.
- **Worried-child alerts.** Santa has a `notify_grown_up` tool. If a child mentions being hurt, grief, hunger, bullying, and so on, he answers gently and the adult gets a private alert. The alert shows as a red dot on the Helper button, so nothing appears on a projected screen.
- **Long calls.** Context-window compression and session resumption keep a call going past Gemini's per-connection limits. When Google asks the connection to move (`goAway`), the server reconnects on its own.

## Classroom tips

- Put the laptop close to where each child stands, and use an external speaker. For a loud room, pick **Hold to talk** in setup.
- The helper panel is on the same screen as Santa. When projecting, extend your display (don't mirror it) and keep the call on the projector. You can also press **H** to hide the panel and bring it back when needed. Keys: **H** helper, **M** mute, **C** captions, **Space** hold-to-talk.
- Tap a child's name as they step up. Santa greets them and uses one of their facts.
- Do a 2-minute test call before the kids arrive.

## Safety, privacy, and the rules

- **Kids' voices and your notes go to Google during the call.** Vertex AI doesn't train on your data. Use first names and friendly facts only. The setup page says this too.
- **COPPA.** Collecting voice from kids under 13 is regulated in the US. A school running this should treat it like any other ed-tech tool: check district policy and get parent permission where required. The app stores nothing, which helps, but it does send audio to Google.
- **"Are you real?"** The adult picks the answer in setup: *keep the magic* ("North Pole magic!", and Santa never claims to be a human) or *be gently honest* ("a computer Santa grown-ups set up"). Some states now require AI disclosure to minors, so check what applies to you.
- **Hard rules in Santa's instructions:** never promise a present, never threaten the naughty list or tie presents to behavior, never ask for last names, addresses, or schools, stay G-rated, and be inclusive of families that have less or don't celebrate Christmas. Read exactly what Santa is told under **Show exactly what Santa will be told** on the setup page.
- **Hosting publicly?** Set `SANTA_ACCESS_CODE` so strangers who find the URL can't use your credits. Calls are also capped by `MAX_SESSIONS` and `MAX_CALL_MINUTES`.

## Cost

At Google's published Gemini 3.8 Live rates ($0.005/min audio in, $0.018/min audio out), a 10-minute call where Santa talks about half the time costs roughly **$0.15**. Vertex AI pricing can differ slightly, so check your console. Demo mode is free.

## Making Santa photoreal

The built-in Santa is an illustrated, animated character. He blinks, breathes, nods while kids talk, glances up while "thinking," laughs at his own "ho ho ho," and his mouth follows the loudness and brightness of his voice. He costs nothing extra and adds no delay, and a friendly cartoon avoids the uncanny valley with young kids.

For a lifelike human Santa, swap `public/js/santa-avatar.js` for a streaming-avatar vendor. The call code only uses `setState()`, `attachVoice()`, `setMicLevel()`, and `laugh()`. Options:

- **Audio-driven avatars** (feed them Gemini's audio, get video back over WebRTC): [Simli](https://www.simli.com), [Anam](https://anam.ai). These keep Gemini as the brain and voice. Budget about 150–300 ms of extra delay and a per-minute fee.
- **All-in-one video agents:** [Tavus](https://www.tavus.io) and HeyGen LiveAvatar bring their own conversation stack. You'd give them the same Santa instructions.
- **Gemini Live Avatar** (Vertex AI, GA Sept 2026): Google now renders avatar video in the same Live session. A *custom* character such as Santa (one reference photo and a voice sample) is allow-list only, so you'd need to ask Google for access.

You'll need a Santa image or video you have the rights to. An actor who agrees to be recorded is the cleanest option.

## Deploying

The server is a single Node process with one dependency for WebSockets. Any host that supports WebSockets works. For **Google Cloud Run**:

- Set `HOST=0.0.0.0` and the Vertex AI variables, and run as a service account with *Vertex AI User*.
- Raise the request timeout to 3600 s so calls aren't cut off.
- Browsers only allow microphones on **HTTPS** (or `localhost`). Cloud Run gives you HTTPS automatically.

## Configuration

See [`.env.example`](.env.example). Everything is optional. With nothing set you get demo mode.

## Project layout

```
server.js                 HTTP + WebSocket server, backend selection, limits
lib/gemini-session.js     one live call ↔ Gemini Live (config, relay, tools, resume)
lib/mock-session.js       demo-mode Santa (no AI)
shared/santa-prompt.js    Santa's instructions (used by the server and the setup preview)
public/index.html         setup page          public/js/setup.js
public/call.html          call screen         public/js/call.js
public/js/santa-avatar.js animated SVG Santa with lip-sync
public/js/audio.js        mic capture + gapless playback
public/js/mic-worklet.js  mic → 16 kHz PCM
test/                     npm test
```

## Status and next steps

This is a working prototype. The whole app runs end to end in demo mode, and 18 automated tests pass (`npm test`). The Gemini Live connection was built against the current SDK's types and a fake Live API, but **it hasn't been run against Google's servers yet**, because no credentials were available where it was built. The first real call is the thing to check. If Santa ignores helper nudges, set `SANTA_TEXT_INPUT=realtime`.

Ideas for next steps:

- A **phone remote** for the helper panel, so the teacher controls the call from their phone while the laptop shows only Santa.
- Hear-before-you-pick **voice previews** in setup.
- A **photoreal avatar** adapter (see above).
- **Multiple languages.** Gemini already switches automatically; the UI would need translating.
