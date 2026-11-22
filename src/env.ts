/** True in the Claude artifact build (`npm run build:artifact`): no service worker, data synced to the artifact db. */
export const IS_ARTIFACT: boolean = import.meta.env.VITE_ARTIFACT === '1';
