import { Outlet } from "react-router";
import { Header } from "../components/Header";
import { TopProgress } from "../components/TopProgress";

export default function Shell() {
  return (
    <div className="min-h-screen bg-bg">
      <TopProgress />
      <Header />
      <Outlet />
    </div>
  );
}
