"use client";
/** Notice/alert banner for success and error messages */

interface NoticeProps {
  message: string;
  type?: 'info' | 'error';
  onDismiss?: () => void;
}

export default function Notice({ message, type = 'info', onDismiss }: NoticeProps) {
  if (!message) return null;
  return (
    <div role={type === 'error' ? 'alert' : 'status'} className={'notice' + (type === 'error' ? ' error' : '')}>
      {message}
      {onDismiss && <button onClick={onDismiss}>Dismiss</button>}
    </div>
  );
}
