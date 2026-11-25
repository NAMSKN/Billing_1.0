import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useToast } from './Toast';

export function CopyButton({
  text,
  label = 'Copy document number',
  className = '',
  size = 14,
}: {
  text: string;
  label?: string;
  className?: string;
  size?: number;
}) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!text) return;
    try {
      if (window.api?.clipboardWrite) {
        await window.api.clipboardWrite(text);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      toast.success(`Copied "${text}" to clipboard`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => void onCopy(e)}
      title={copied ? 'Copied!' : label}
      aria-label={label}
      className={`inline-flex items-center justify-center p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${className}`}
    >
      {copied ? (
        <Check size={size} className="text-success" />
      ) : (
        <Copy size={size} />
      )}
    </button>
  );
}
