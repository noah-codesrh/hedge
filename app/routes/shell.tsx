import { Outlet } from "react-router";
import { Footer } from "../components/Footer";
import { Header } from "../components/Header";
import { TopProgress } from "../components/TopProgress";

export default function Shell() {
  return (
    <div className="min-h-screen bg-bg">
      <TopProgress />
      <Header />
      <Outlet />
      <Footer />
    </div>
  );
}
