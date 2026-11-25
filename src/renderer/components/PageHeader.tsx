import type { ReactNode } from 'react';
import { CopyButton } from './CopyButton';

export function PageHeader({
  title,
  description,
  actions,
  copyText,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  copyText?: string;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {copyText && <CopyButton text={copyText} size={16} />}
        </div>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
