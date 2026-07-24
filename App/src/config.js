// Base URL of the Dispatches backend API.
//
// Defaults to the deployed Render service so the app works with no config.
// Override at build time with REACT_APP_API_URL — e.g. `http://localhost:8080`
// for local development, or a new host if the backend ever moves. Create React
// App only exposes env vars prefixed with REACT_APP_, and inlines them at build
// time, so changing this requires a rebuild (not just a server restart).
const API_BASE = (
  process.env.REACT_APP_API_URL || 'https://node-social-zmra.onrender.com'
)
  .trim()
  .replace(/[/.]+$/, ''); // strip trailing whitespace/slashes/dots so a stray
                          // `.../onrender.com.` typo can't cause a TLS-name
                          // mismatch, and `${API_BASE}/graphql` stays clean

export default API_BASE;

// Full endpoints derived from the base — import these instead of hardcoding.
export const GRAPHQL_URL = `${API_BASE}/graphql`;
export const POST_IMAGE_URL = `${API_BASE}/post-image`;
export const AVATAR_UPLOAD_URL = `${API_BASE}/avatar-upload`;
