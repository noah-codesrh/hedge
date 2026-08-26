import { Outlet } from "react-router";
import { Header } from "../components/Header";

export default function Shell() {
  return (
    <div className="min-h-screen bg-bg">
      <Header />
      <Outlet />
    </div>
  );
}
