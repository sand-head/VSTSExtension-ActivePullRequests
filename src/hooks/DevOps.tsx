import * as SDK from 'azure-devops-extension-sdk';
import { useEffect, useState } from 'react';

export function useAzureDevOpsSDK<T>(callback: () => T | Promise<T>) {
  const [callbackValue, setCallbackValue] = useState<T>();

  useEffect(() => {
    async function init() {
      await SDK.init();
      setCallbackValue(await Promise.resolve(callback()));
      await SDK.notifyLoadSucceeded();
    }
    init();
  }, []);

  return callbackValue;
}
