import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  status
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <header className="app-page-header">
      <div className="app-page-heading">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {(actions || status) && (
        <div className="app-page-header-aside">
          {status}
          {actions}
        </div>
      )}
    </header>
  );
}
