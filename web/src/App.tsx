import type { LeeTkobApiClient } from './api/client.interface';
import { ApiClientProvider } from './api/client-context';
import { defaultHomePathForRole, useAuth } from './auth/auth-context-core';
import { AuthProvider } from './auth/auth-context';
import { AppHeader } from './components/AppHeader';
import { ForbiddenPanel } from './components/StatePanels';
import { AdminClassesPage } from './pages/admin/AdminClassesPage';
import { LoginPage } from './pages/LoginPage';
import { StudentLabsPage } from './pages/student/StudentLabsPage';
import { StudentLabSolvePage } from './pages/student/StudentLabSolvePage';
import { TaClassLabsPage } from './pages/ta/TaClassLabsPage';
import { TaCreateLabPage } from './pages/ta/TaCreateLabPage';
import { TaReviewQueuePage } from './pages/ta/TaReviewQueuePage';
import { RouterProvider } from './router/router';
import { matchPath, useRouter } from './router/router-core';
import type { AuthSession, UserRole } from './types/auth';

function AppRoutes() {
  const { pathname, navigate } = useRouter();
  const { session } = useAuth();

  if (pathname === '/' || pathname === '') {
    if (!session) {
      return <LoginPage />;
    }
    const target = defaultHomePathForRole(session.user.role);
    if (pathname !== target) {
      queueMicrotask(() => navigate(target, { replace: true }));
    }
    return null;
  }

  if (pathname === '/login') {
    return <LoginPage />;
  }

  if (!session) {
    return <LoginPage />;
  }

  const requireRoles = (allowed: UserRole[], element: JSX.Element): JSX.Element => {
    if (!allowed.includes(session.user.role)) {
      return (
        <ForbiddenPanel
          status={403}
          message={`Vai trò hiện tại (${session.user.role}) không có quyền truy cập trang này.`}
        />
      );
    }
    return element;
  };

  if (matchPath('/admin/classes', pathname)) {
    return requireRoles(['ADMIN'], <AdminClassesPage />);
  }

  if (matchPath('/ta/classes', pathname)) {
    return requireRoles(['TA', 'ADMIN'], <TaClassLabsPage />);
  }

  const taClassMatch = matchPath('/ta/classes/:classId', pathname);
  if (taClassMatch) {
    return requireRoles(['TA', 'ADMIN'], <TaClassLabsPage classId={taClassMatch.classId} />);
  }

  const taNewLabMatch = matchPath('/ta/classes/:classId/labs/new', pathname);
  if (taNewLabMatch) {
    return requireRoles(['TA', 'ADMIN'], <TaCreateLabPage classId={taNewLabMatch.classId} />);
  }

  const taReviewMatch = matchPath('/ta/labs/:labId/review', pathname);
  if (taReviewMatch) {
    return requireRoles(['TA', 'ADMIN'], <TaReviewQueuePage labId={taReviewMatch.labId} />);
  }

  if (matchPath('/student/labs', pathname)) {
    return requireRoles(['STUDENT'], <StudentLabsPage />);
  }

  const studentLabMatch = matchPath('/student/labs/:labId', pathname);
  if (studentLabMatch) {
    return requireRoles(['STUDENT'], <StudentLabSolvePage labId={studentLabMatch.labId} />);
  }

  return (
    <ForbiddenPanel
      status={404}
      message="Đường dẫn bạn truy cập không tồn tại hoặc không thuộc quyền tài khoản hiện tại."
    />
  );
}

export interface AppProps {
  apiClient?: LeeTkobApiClient;
  initialPath?: string;
  initialSession?: AuthSession | null;
}

export function App({ apiClient, initialPath, initialSession }: AppProps) {
  return (
    <ApiClientProvider client={apiClient}>
      <AuthProvider initialSession={initialSession}>
        <RouterProvider initialPath={initialPath}>
          <AppHeader />
          <main>
            <AppRoutes />
          </main>
        </RouterProvider>
      </AuthProvider>
    </ApiClientProvider>
  );
}
