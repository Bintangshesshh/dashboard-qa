"use client";
/** Administrator account management */

import type { User, UserRole } from '../lib/types';
import { stamp } from '../lib/format';

interface UsersViewProps {
  users: User[];
  currentUserId: string;
  busy: boolean;
  onRoleChange: (user: User, role: UserRole) => void;
  onDelete: (user: User) => void;
  onReload: () => void;
}

export default function UsersView({
  users, currentUserId, busy, onRoleChange, onDelete, onReload,
}: UsersViewProps) {
  return (
    <section className="users-view">
      <div className="section-title">
        <div>
          <h2>Team accounts</h2>
          <p className="muted">Administrators manage accounts. Members can use the QA workspace.</p>
        </div>
        <button onClick={onReload} disabled={busy}>Refresh</button>
      </div>
      <div className="scroll-table">
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Created</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {users.map(user => {
              const self = user.id === currentUserId;
              return (
                <tr key={user.id}>
                  <td>
                    {user.name}
                    {self && <small>Current account</small>}
                  </td>
                  <td>{user.email}</td>
                  <td>
                    <select
                      aria-label={'Role for ' + user.name}
                      value={user.role}
                      disabled={busy || self}
                      onChange={e => onRoleChange(user, e.target.value as UserRole)}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Administrator</option>
                    </select>
                    {self && <small>Change another administrator first.</small>}
                  </td>
                  <td>{stamp(user.createdAt)}</td>
                  <td>
                    <button
                      disabled={busy || self}
                      onClick={() => onDelete(user)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!users.length && <p>No accounts loaded.</p>}
    </section>
  );
}
