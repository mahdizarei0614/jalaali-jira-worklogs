import { AppApi } from './app-api.types';

declare global {
  interface Window {
    appApi?: AppApi;
  }
}

export {};
