import { restoreSession } from './utils/session';
App({ onLaunch() { restoreSession(); } });
