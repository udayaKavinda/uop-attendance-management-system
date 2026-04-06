# UOP Attendance Management System

This repository contains a React frontend and a simple Node/Express backend with MongoDB.
The application implements an attendance flow where a student signs in with Google, enters a lecture code, and has their location checked before the attendance is recorded.

## Project structure

```
├─ public/           # static assets
├─ src/              # React application (CRA)
│  ├─ components/    # custom UI components
│  ├─ api.js         # helper for backend calls
│  └─ ...
├─ server/           # Node/Express backend
│  ├─ models/        # mongoose schemas
│  └─ index.js       # express server and routes
├─ package.json
└─ README.md
```

## Running locally

1. **Install dependencies**
   ```bash
   npm install
   cd server && npm install express mongoose cors
   # optionally install dev tooling like nodemon or concurrently
   npm install --save-dev concurrently
   ```

2. **Start both frontend and backend**
   ```bash
   npm run dev
   ```

   - frontend: `http://localhost:3000`
   - backend: `http://localhost:5000` (API prefixed with `/api`)

3. **MongoDB**
   Ensure you have a MongoDB instance running locally or point `MONGO_URI` to your database.

4. **Environment (single `.env` in project root)**  
   Create a `.env` file in the project root. The server and Create React App both read from it. Example:

   ```env
   REACT_APP_API_BASE=http://localhost:5000
   FRONTEND_URL=http://localhost:3000
   MONGO_URI=mongodb://localhost:27017/attendance
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

   Get Google OAuth values from Google Cloud Console → Credentials → OAuth 2.0 Client (Web application). Without them, `/auth/google` will not work. Optional: `SESSION_SECRET` (random string).

5. **Expose frontend through ngrok**  
   To get a public URL for the React app (e.g. for mobile testing):

   - Install [ngrok](https://ngrok.com/download) and sign in.
   - Start the app: `npm run dev`.
   - In another terminal: `npm run tunnel` (or `ngrok http 3000`) to get a frontend URL.
   - For **Google sign-in to work with ngrok**, you must also expose the backend. In a **third** terminal run: `ngrok http 5000`. You will have two ngrok URLs (e.g. one for 3000, one for 5000).
   - In `.env` set:
     - `FRONTEND_URL=https://YOUR-FRONTEND-NGROK-URL` (the tunnel to port 3000)
     - `REACT_APP_API_BASE=https://YOUR-BACKEND-NGROK-URL` (the tunnel to port 5000)
   - In **Google Cloud Console** → your OAuth 2.0 Client → add:
     - **Authorized JavaScript origins:** `https://YOUR-FRONTEND-NGROK-URL` and `https://YOUR-BACKEND-NGROK-URL`
     - **Authorized redirect URIs:** `https://YOUR-BACKEND-NGROK-URL/auth/google/callback`
   - Restart `npm run dev` after changing `.env`. Then open the **frontend** ngrok URL in the browser; sign-in will redirect to the backend ngrok URL and back correctly.

## Flow overview

1. Student taps **Sign in with Google**; no manual email/ID entry is required.
2. Backend identifies or creates the corresponding student account using the Google profile.
3. The student enters a lecture code.
4. Backend validates the code and checks geolocation (geo‑fencing) (placeholder logic until implemented).
5. If everything passes, attendance is recorded in MongoDB.

> **Note:** Google OAuth client ID/secret must be set (see "Google login" section below). Without them the `/auth/google` route will log a warning and not function.

The stubbed backend in `server/index.js` contains placeholder routes you can flesh out as you build the real logic.

---

The remainder of this file is the original CRA README (truncated)

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
