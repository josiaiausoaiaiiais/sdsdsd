import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Library from "@/pages/Library";
import Favorites from "@/pages/Favorites";
import Webinars from "@/pages/Webinars";
import Channels from "@/pages/Channels";
import Analytics from "@/pages/Analytics";
import Remix from "@/pages/Remix";
import Studio from "@/pages/Studio";
import { LoginPage, SignupPage } from "@/pages/Auth";
import { ForgotPasswordPage, ResetPasswordPage } from "@/pages/Password";
import ChannelEmbed from "@/pages/ChannelEmbed";
import { AuthProvider, useAuth } from "@/lib/auth";

function Protected({ children }) {
  const { user } = useAuth();
  if (user === null) return <div className="min-h-screen flex items-center justify-center bg-background"><div className="font-display text-xl">Brewing…</div></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/c/:slug" element={<ChannelEmbed />} />
            <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
            <Route path="/dashboard/library" element={<Protected><Library /></Protected>} />
            <Route path="/dashboard/favorites" element={<Protected><Favorites /></Protected>} />
            <Route path="/dashboard/webinars" element={<Protected><Webinars /></Protected>} />
            <Route path="/dashboard/channels" element={<Protected><Channels /></Protected>} />
            <Route path="/dashboard/analytics" element={<Protected><Analytics /></Protected>} />
            <Route path="/dashboard/remix" element={<Protected><Remix /></Protected>} />
            <Route path="/dashboard/studio" element={<Protected><Studio /></Protected>} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
