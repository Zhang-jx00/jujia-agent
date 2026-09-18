import type { JujiaApi } from '../../preload/index';

declare global {
  interface Window {
    jujia: JujiaApi;
  }
}

export {};
