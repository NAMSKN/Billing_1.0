import React, { useState, useEffect, useRef } from 'react';
import { Lock, AlertCircle } from 'lucide-react';
import { Button, Card, Input } from './ui';

export const UNLOCKED_SESSION_KEY = 'moulder_app_unlocked';

export const AppLockGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [pinLength, setPinLength] = useState<number>(4);
  const [isUnlocked, setIsUnlocked] = useState<boolean>(() => {
    return sessionStorage.getItem(UNLOCKED_SESSION_KEY) === '1';
  });
  const [inputPin, setInputPin] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [verifying, setVerifying] = useState<boolean>(false);
  const [loadingStatus, setLoadingStatus] = useState<boolean>(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const checkStatus = async () => {
    try {
      setLoadingStatus(true);
      const res = await window.api.appLock.getStatus();
      if (res.ok) {
        setEnabled(res.data.enabled);
        setPinLength(res.data.length || 4);
      }
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  const handleVerify = async (pinToTest = inputPin) => {
    if (verifying) return;
    setVerifying(true);
    setErrorMsg('');

    try {
      const res = await window.api.appLock.verifyPin(pinToTest);
      if (res.ok && res.data) {
        sessionStorage.setItem(UNLOCKED_SESSION_KEY, '1');
        setIsUnlocked(true);
        setInputPin('');
      } else {
        setErrorMsg('Incorrect PIN. Please try again.');
        setInputPin('');
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, pinLength);
    setInputPin(val);
    setErrorMsg('');
    if (val.length === pinLength) {
      handleVerify(val);
    }
  };

  if (loadingStatus) {
    return null;
  }

  if (enabled && !isUnlocked) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950 p-4">
        <Card className="w-full max-w-sm p-8 text-center space-y-6 shadow-2xl border-slate-800 bg-surface">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Lock className="h-7 w-7" />
          </div>

          <div>
            <h2 className="text-xl font-bold text-foreground">App Locked</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Enter your {pinLength}-digit security PIN to unlock Moulder Billing.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleVerify();
            }}
            className="space-y-4"
          >
            <div>
              <Input
                ref={inputRef}
                type="password"
                inputMode="numeric"
                autoFocus
                placeholder={'•'.repeat(pinLength)}
                value={inputPin}
                onChange={handleChange}
                maxLength={pinLength}
                className="text-center text-2xl tracking-[0.5em] font-mono h-12"
              />
            </div>

            {errorMsg && (
              <div className="text-xs text-danger flex items-center justify-center gap-1.5 font-medium">
                <AlertCircle className="h-4 w-4" />
                <span>{errorMsg}</span>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              disabled={inputPin.length !== pinLength || verifying}
              className="w-full"
            >
              {verifying ? 'Verifying...' : 'Unlock'}
            </Button>
          </form>

          <p className="text-[11px] text-muted-foreground">
            Screen lock protects client rates and workshop financial records on shared computers.
          </p>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
};
