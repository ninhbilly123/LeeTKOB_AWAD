import { useState } from 'react';
import { useApiClient } from '../api/api-context';
import { defaultHomePathForRole, useAuth } from '../auth/auth-context-core';
import { Link } from '../router/router';
import { useRouter } from '../router/router-core';
import styles from './AppHeader.module.css';

export function AppHeader() {
  const api = useApiClient();
  const { session, logout } = useAuth();
  const { pathname, navigate } = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto');

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = session
    ? session.user.role === 'ADMIN'
      ? [{ to: '/admin/classes', label: 'Quản lý Lớp học' }]
      : session.user.role === 'TA'
        ? [{ to: '/ta/classes', label: 'Lớp & Bài Lab (TA)' }]
        : [{ to: '/student/labs', label: 'Bài Lab của tôi' }]
    : [{ to: '/login', label: 'Đăng nhập' }];

  const homePath = session ? defaultHomePathForRole(session.user.role) : '/login';

  return (
    <header className={styles.header}>
      <a href="#main-content" className="skip-link">
        Chuyển tới nội dung chính
      </a>
      <div className={styles.inner}>
        <div className={styles.brandGroup}>
          <Link to={homePath} className={styles.brandLink}>
            LeeTKOB
          </Link>
          <span className={`${styles.modeChip} mono`} title="Chế độ lớp dữ liệu hiện tại">
            {api.mode === 'mock' ? 'MOCK API' : 'LIVE HTTP'}
          </span>
        </div>

        <button
          type="button"
          className={`btn ${styles.menuToggle}`}
          aria-expanded={mobileMenuOpen}
          aria-controls="primary-nav"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
        >
          {mobileMenuOpen ? 'Đóng menu' : 'Menu'}
        </button>

        <nav
          id="primary-nav"
          aria-label="Điều hướng chính"
          className={`${styles.navCollapse} ${mobileMenuOpen ? '' : styles.navHidden}`}
        >
          <ul className={styles.navList}>
            {navItems.map((item) => {
              const isActive = pathname === item.to || pathname.startsWith(`${item.to}/`);
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={styles.navLink}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className={styles.actions}>
          <button
            type="button"
            className="btn"
            onClick={toggleTheme}
            aria-label="Chuyển đổi giao diện sáng và tối"
          >
            {theme === 'dark' ? 'Chế độ Sáng' : 'Chế độ Tối'}
          </button>

          {session && (
            <>
              <span className={`${styles.roleChip} mono`}>{session.user.role}</span>
              <span className={styles.userName}>{session.user.displayName}</span>
              <button type="button" className="btn" onClick={handleLogout}>
                Đăng xuất
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
