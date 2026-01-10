import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { DripsDocumentation } from "@/components/organisms/drips-documentation";
import { ChevronRight } from "lucide-react";

export const Route = createFileRoute("/documentation")({
  component: DocumentationComponent,
});

function DocumentationComponent() {
  const [activeSection, setActiveSection] = useState("introduction");
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Trigger animation after component mounts
    const timer = setTimeout(() => setIsLoaded(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const sections = [
    { id: "introduction", title: "Introduction" },
    { id: "getting-started", title: "Getting Started" },
    { id: "overview", title: "Overview" },
    { id: "accounts", title: "Accounts in Xylkit" },
    { id: "account-metadata", title: "Account Metadata" },
    { id: "inner-workings", title: "Inner Workings" },
    { id: "fractional-amounts", title: "Fractional Amounts" },
    { id: "features", title: "Xylkit Features" },
    { id: "credits", title: "Credits" },
    { id: "faq", title: "FAQ" },
  ];

  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 100;

      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element) {
          const { offsetTop, offsetHeight } = element;
          if (scrollPosition >= offsetTop && scrollPosition < offsetTop + offsetHeight) {
            setActiveSection(section.id);
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      const offset = 80;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black pt-24">
      <div className="container mx-auto px-4 py-8 flex gap-8 max-w-7xl">
        {/* Sidebar */}
        <aside
          className={`w-64 hidden lg:block shrink-0 sticky top-8 h-fit transition-all duration-700 ${
            isLoaded
              ? "opacity-100 translate-x-0"
              : "opacity-0 -translate-x-8"
          }`}
        >
          <nav className="space-y-1">
            <h2 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-wider">
              Documentation
            </h2>
            {sections.map((section, index) => (
              <button
                key={section.id}
                onClick={() => scrollToSection(section.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2 focus:outline-none ${
                  activeSection === section.id
                    ? "bg-blue-500/20 text-blue-400 font-medium"
                    : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                }`}
                style={{
                  transitionDelay: isLoaded ? `${index * 50}ms` : "0ms",
                  opacity: isLoaded ? 1 : 0,
                  transform: isLoaded ? "translateX(0)" : "translateX(-20px)",
                }}
              >
                {activeSection === section.id && (
                  <ChevronRight size={16} className="text-blue-400" />
                )}
                <span className={activeSection === section.id ? "" : "ml-6"}>
                  {section.title}
                </span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main
          className={`flex-1 max-w-4xl transition-all duration-700 delay-200 ${
            isLoaded
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-8"
          }`}
        >
          <DripsDocumentation />
        </main>
      </div>
    </div>
  );
}
