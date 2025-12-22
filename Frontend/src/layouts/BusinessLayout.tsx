import React, { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import homeLogo from "../assets/homelogo.png";
import approvalsLogo from "../assets/approvalslogo.png";
import shiftPayoutLogo from "../assets/shiftpayoutlogo.png";
import reportsLogo from "../assets/reportslogo.png";
import teamLogo from "../assets/teamlogo.png";
import settingsLogo from "../assets/settingslogo.png";

const BusinessLayout: React.FC = () => {
  const [logoData, setLogoData] = useState<string>("");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isSidebarHovered, setIsSidebarHovered] = useState<boolean>(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState<boolean>(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const { restaurantKey } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const loadLogo = async (): Promise<void> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await (window as any).fs.readFile("image.png");
        const blob = new Blob([data], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        setLogoData(url);
      } catch (error) {
        console.error("Error loading logo:", error);
      }
    };
    loadLogo();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const storedUserName = localStorage.getItem("userName") || "User";
  const restaurantName = localStorage.getItem("restaurantName") || "";
  const userInitials =
    storedUserName
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase())
      .slice(0, 2)
      .join("") || "U";
  const businessBase = restaurantKey ? `/business/${restaurantKey}` : "/business";
  const isCompactSidebar = isSidebarCollapsed && !isSidebarHovered;

  const navItems = [
    {
      label: "Home",
      to: `${businessBase}/home`,
      icon: <img src={homeLogo} alt="Home" className="h-8 w-8 object-contain" />,
    },
    {
      label: "Approvals",
      to: `${businessBase}/approvals`,
      icon: (
        <span
          aria-hidden="true"
          className={`inline-block ${isCompactSidebar ? "h-7 w-7" : "h-8 w-8"}`}
          style={{
            backgroundColor: "currentColor",
            WebkitMaskImage: `url(${approvalsLogo})`,
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            WebkitMaskSize: "100% 100%",
            maskImage: `url(${approvalsLogo})`,
            maskRepeat: "no-repeat",
            maskPosition: "center",
            maskSize: "100% 100%",
          }}
        />
      ),
    },
    {
      label: "Shift Payout",
      to: `${businessBase}/shift-payout`,
      icon: (
        <span
          aria-hidden="true"
          className={`inline-block ${isCompactSidebar ? "h-7 w-7" : "h-8 w-8"}`}
          style={{
            backgroundColor: "currentColor",
            WebkitMaskImage: `url(${shiftPayoutLogo})`,
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            WebkitMaskSize: "100% 100%",
            maskImage: `url(${shiftPayoutLogo})`,
            maskRepeat: "no-repeat",
            maskPosition: "center",
            maskSize: "100% 100%",
          }}
        />
      ),
    },
    {
      label: "Employees",
      to: `${businessBase}/employees`,
      icon: (
        <span
          aria-hidden="true"
          className={`inline-block ${isCompactSidebar ? "h-7 w-7" : "h-8 w-8"}`}
          style={{
            backgroundColor: "currentColor",
            WebkitMaskImage: `url(${teamLogo})`,
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            WebkitMaskSize: "100% 100%",
            maskImage: `url(${teamLogo})`,
            maskRepeat: "no-repeat",
            maskPosition: "center",
            maskSize: "100% 100%",
          }}
        />
      ),
    },
    {
      label: "Reports",
      to: `${businessBase}/reports`,
      icon: (
        <span
          aria-hidden="true"
          className={`inline-flex items-center justify-center self-center ${isCompactSidebar ? "h-10 w-10" : "h-11 w-11"}`}
          style={{
            backgroundColor: "currentColor",
            WebkitMaskImage: `url(${reportsLogo})`,
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            WebkitMaskSize: "100% 100%",
            maskImage: `url(${reportsLogo})`,
            maskRepeat: "no-repeat",
            maskPosition: "center",
            maskSize: "100% 100%",
          }}
        />
      ),
    },
    {
      label: "Settings",
      to: `${businessBase}/settings`,
      icon: (
        <span
          aria-hidden="true"
          className={`inline-block ${isCompactSidebar ? "h-7 w-7" : "h-8 w-8"}`}
          style={{
            backgroundColor: "currentColor",
            WebkitMaskImage: `url(${settingsLogo})`,
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            WebkitMaskSize: "100% 100%",
            maskImage: `url(${settingsLogo})`,
            maskRepeat: "no-repeat",
            maskPosition: "center",
            maskSize: "100% 100%",
          }}
        />
      ),
    },
  ];

  return (
    <div className="h-screen w-full overflow-hidden" style={{ backgroundColor: "#f4f2ee" }}>
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-200 px-6 flex items-center justify-between shadow-sm fixed top-0 left-0 right-0 z-40 h-16">
        {logoData ? (
          <img src={logoData} alt="Gratly Logo" className="h-10" />
        ) : (
          <div className="text-2xl font-bold text-gray-900">GRATLY</div>
        )}
        {restaurantName ? (
          <div className="absolute left-1/2 -translate-x-1/2 text-center text-lg font-semibold text-gray-700 max-w-[40vw] truncate">
            {restaurantName}
          </div>
        ) : null}
        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setIsUserMenuOpen((prev) => !prev)}
            className="flex items-center gap-3 rounded-full border border-gray-200 bg-white px-3 py-2 shadow-sm hover:bg-gray-50"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-sm font-semibold text-white">
              {userInitials}
            </span>
            <span className="text-sm font-semibold text-gray-900">{storedUserName}</span>
            <span className="text-sm text-gray-500">▾</span>
          </button>
          {isUserMenuOpen && (
            <div className="absolute right-0 mt-2 w-48 rounded-lg border border-gray-200 bg-white shadow-lg">
              <Link
                to={`${businessBase}/profile`}
                className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => setIsUserMenuOpen(false)}
              >
                Profile
              </Link>
              <button
                type="button"
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
              >
                Subscription
              </button>
              <button
                type="button"
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => navigate("/login")}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <div
          className={`bg-white border-r border-gray-200 p-6 fixed top-16 left-0 h-[calc(100vh-4rem)] overflow-y-auto transition-all duration-200 ${
            isSidebarCollapsed && !isSidebarHovered ? "w-20" : "w-64"
          }`}
          onMouseEnter={() => setIsSidebarHovered(true)}
          onMouseLeave={() => setIsSidebarHovered(false)}
          onClick={() => {
            if (isSidebarCollapsed) {
              setIsSidebarCollapsed(false);
            }
          }}
        >
          <div className={`flex ${isSidebarCollapsed ? "justify-center" : "justify-end"} mb-4`}>
            <button
              type="button"
              onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                setIsSidebarCollapsed((prev) => {
                  const next = !prev;
                  if (next) {
                    setIsSidebarHovered(false);
                  }
                  return next;
                });
              }}
              className="inline-flex h-6 w-6 items-center justify-center bg-transparent border-0 p-0 text-black hover:text-black dark:text-black dark:hover:text-black"
              aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <span className="flex flex-col items-center gap-1">
                <span className="block h-0.5 w-4 bg-current" />
                <span className="block h-0.5 w-4 bg-current" />
                <span className="block h-0.5 w-4 bg-current" />
              </span>
            </button>
          </div>
          <nav className="space-y-2">
            {navItems.map((item) => {
              const isActive = location.pathname === item.to;
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  className={`w-full text-left py-3 font-medium transition-all block ${
                    isActive
                      ? `bg-[#cab99a] text-gray-900${isCompactSidebar ? "" : " shadow-md"}`
                      : "text-gray-700 hover:bg-[#e6d7b8] hover:!text-black visited:text-gray-700"
                  } ${isCompactSidebar ? "px-0 -ml-1 w-[calc(100%+0.5rem)] rounded-md" : "px-4 rounded-lg"}`}
                >
                  <span className="inline-flex items-center gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center">
                      {item.icon}
                    </span>
                    {(!isSidebarCollapsed || isSidebarHovered) && <span>{item.label}</span>}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Main Content */}
        <div
          className={`flex-1 mt-16 h-[calc(100vh-4rem)] overflow-y-auto ${
            isSidebarCollapsed && !isSidebarHovered ? "ml-20" : "ml-64"
          }`}
        >
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default BusinessLayout;
