import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  Bot,
  Store,
  Chrome,
  MessageSquare,
  Paperclip,
  Settings,
  PlusCircle,
  Check,
  ChevronDown,
  Building,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  ArrowUpRight,
  X,
  Sun,
  Moon,
  BookOpen,
} from 'lucide-react';
import { useUI, useWorkspace } from '../store';
import { can } from '../lib/permissions';
import { CHROME_STORE_URL } from '../lib/links';
import { IS_SELF_HOSTED } from '../lib/env';
import { useExtensionInstalled } from '../hooks/useExtensionInstalled';
import Modal from './ui/Modal';
import Button from './ui/Button';

interface SidebarProps {
  mobileOpen?: boolean;
  setMobileOpen?: (open: boolean) => void;
}

const Sidebar = ({ mobileOpen = false, setMobileOpen }: SidebarProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { workspace, currentUser, availableWorkspaces, switchWorkspace, createWorkspace } = useWorkspace();
  const { showToast, theme, toggleTheme } = useUI();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [tooltip, setTooltip] = useState<{ label: string, top: number } | null>(null);
  const extensionInstalled = useExtensionInstalled(); // SQEM-079 — hide the Install link once detected

  // Workspace Management State
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [workspaceNameError, setWorkspaceNameError] = useState('');
  const workspaceMenuRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(event.target as Node)) {
      setIsWorkspaceMenuOpen(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [handleClickOutside]);

  useEffect(() => {
    if (!isCollapsed) {
      setTooltip(null);
    }
  }, [isCollapsed]);

  const isActive = (path: string) => location.pathname === path;

  const closeMobileMenu = () => {
    if (setMobileOpen) setMobileOpen(false);
  };

  const handleCreateWorkspace = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) {
      setWorkspaceNameError('Workspace name is required');
      return;
    }
    createWorkspace(newWorkspaceName);
    setNewWorkspaceName('');
    setWorkspaceNameError('');
    setIsWorkspaceModalOpen(false);
    setIsWorkspaceMenuOpen(false);
    showToast("Workspace created successfully", "success");
  }, [newWorkspaceName, createWorkspace, showToast]);

  const showTooltip = (e: React.MouseEvent, label: string) => {
    if (isCollapsed) {
      const rect = e.currentTarget.getBoundingClientRect();
      setTooltip({ label, top: rect.top + rect.height / 2 });
    }
  };

  const hideTooltip = () => {
    setTooltip(null);
  };

  const planColors = {
    Solo: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
    Team: 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400',
    Business: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800',
    Managed: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400',
  };

  const navLinks: { to: string; icon: any; label: string; beta?: boolean; arrow?: boolean }[] = [
    { to: "/", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/files", icon: Paperclip, label: "Files" },
    { to: "/templates", icon: FileText, label: "Templates" },
    { to: "/library", icon: Store, label: "Marketplace" },
    { to: "/chat", icon: MessageSquare, label: "Chat", arrow: true },
  ];

  const visibleNavLinks = navLinks.filter(link => {
    if (!can(currentUser, workspace, 'settings:general')) {
      return !['/library', '/files'].includes(link.to);
    }
    return true;
  });

  const renderNavItem = (to: string, Icon: any, label: string, beta?: boolean, arrow?: boolean) => {
    const active = isActive(to);
    return (
      <Link
        key={to}
        to={to}
        onClick={closeMobileMenu}
        onMouseEnter={(e) => showTooltip(e, label)}
        onMouseLeave={hideTooltip}
        className={`relative flex items-center gap-3 ${isCollapsed ? 'justify-center px-2' : 'px-3'} py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group ${
          active
            ? 'bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-400'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100'
        }`}
      >
        <Icon className={`w-5 h-5 transition-colors shrink-0 ${active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'}`} />
        {!isCollapsed && (
          <>
            <span className="truncate">{label}</span>
            {beta && (
              <span className="ml-auto text-3xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 shrink-0">
                Beta
              </span>
            )}
            {arrow && (
              <ArrowRight className={`w-4 h-4 ml-auto shrink-0 transition-colors ${active ? 'text-brand-500 dark:text-brand-400' : 'text-slate-300 dark:text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-400'}`} />
            )}
          </>
        )}
      </Link>
    );
  };

  return (
    <>
      <div
        className={`fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 transition-opacity md:hidden ${mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={closeMobileMenu}
      />
      {/* Mobile close — floats just outside the drawer on the dimmed overlay, with its own bg */}
      {mobileOpen && (
        <button
          onClick={closeMobileMenu}
          aria-label="Close menu"
          className="fixed top-3 left-64 ml-2 z-[60] p-2 rounded-full bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 shadow-lg hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors md:hidden"
        >
          <X className="w-5 h-5" />
        </button>
      )}
      <div className={`
        fixed inset-y-0 left-0 z-50 bg-white dark:bg-slate-800 border-r border-slate-100 dark:border-slate-700 shadow-soft transition-transform duration-300 transform flex flex-col
        md:translate-x-0 md:static md:h-full
        ${mobileOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64'}
        ${isCollapsed && !mobileOpen ? 'md:w-20' : 'md:w-64'}
      `}>
        {/* Desktop Collapse Toggle */}
        <button 
           onClick={() => {
             setIsCollapsed(!isCollapsed);
             setIsWorkspaceMenuOpen(false);
           }}
           className="hidden md:flex absolute -right-3 top-9 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 rounded-full p-1 shadow-md z-50 hover:scale-110 transition-all"
        >
           {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>

        <div className={`p-6 relative z-[60] ${isCollapsed ? 'px-4 flex flex-col items-center' : ''}`}>
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} mb-1 transition-all`}>
            <img src="/logo-favicon-V2.png" alt="sqemes" className="w-10 h-10 rounded-xl shrink-0 shadow-sm" />
            {!isCollapsed && (
              <div className="animate-fade-in">
                <div className="flex items-center gap-2">
                  <h1 className="font-bold text-slate-900 dark:text-slate-100 leading-tight tracking-tight text-xl">sqemes</h1>
                  {/* SQEM-119 — no plan tier on self-host */}
                  {!IS_SELF_HOSTED && (
                  <span className={`text-2xs font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${workspace.isManaged ? planColors.Managed : (planColors[workspace.plan] || planColors.Solo)}`}>
                    {workspace.isManaged ? 'Managed' : workspace.plan}
                  </span>
                  )}
                </div>
                
                <div className="relative" ref={workspaceMenuRef}>
                  <button 
                    onClick={() => setIsWorkspaceMenuOpen(!isWorkspaceMenuOpen)}
                    className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 font-medium hover:text-brand-600 dark:hover:text-brand-400 transition-colors mt-0.5 group outline-none"
                  >
                    <span className="truncate max-w-[120px]">{workspace.name}</span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${isWorkspaceMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Workspace Dropdown */}
                  {isWorkspaceMenuOpen && (
                    <div className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700 py-1 z-[100] animate-scale-up origin-top-left">
                      <div className="px-3 py-2 border-b border-slate-50 dark:border-slate-700">
                        <p className="text-2xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Switch Workspace</p>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {availableWorkspaces.map(ws => (
                          <button
                            key={ws.id}
                            onClick={() => {
                              switchWorkspace(ws.id);
                              setIsWorkspaceMenuOpen(false);
                            }}
                            className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-6 h-6 rounded bg-slate-100 dark:bg-slate-600 flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                                <Building className="w-3 h-3" />
                              </div>
                              <span className={`text-sm font-medium truncate ${ws.id === workspace.id ? 'text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}>
                                {ws.name}
                              </span>
                            </div>
                            {ws.id === workspace.id && <Check className="w-4 h-4 text-brand-600 dark:text-brand-400" />}
                          </button>
                        ))}
                      </div>
                      {/* SQEM-121 — self-host is a single-instance deployment: no adding workspaces */}
                      {!IS_SELF_HOSTED && (
                      <div className="p-1 border-t border-slate-50 dark:border-slate-700 mt-1">
                        <button
                          onClick={() => {
                            setIsWorkspaceModalOpen(true);
                            setIsWorkspaceMenuOpen(false);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-brand-600 dark:hover:text-brand-400 rounded-lg transition-colors"
                        >
                          <PlusCircle className="w-4 h-4" />
                          Create Workspace
                        </button>
                      </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2 px-4 space-y-1 overflow-x-hidden scrollbar-thin">
          <div className="mb-6 space-y-1">
            {visibleNavLinks.map(link => renderNavItem(link.to, link.icon, link.label, link.beta, link.arrow))}
          </div>
        </div>

        <div className={`p-4 pb-6 border-t border-slate-100 dark:border-slate-700 space-y-2 ${isCollapsed ? 'flex flex-col items-center' : ''}`}>
          {!extensionInstalled && (
            <a
              href={CHROME_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onMouseEnter={(e) => showTooltip(e, 'Install Extension')}
              onMouseLeave={hideTooltip}
              className={`flex items-center gap-3 ${isCollapsed ? 'justify-center px-2' : 'px-3'} py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100`}
            >
              <Chrome className="w-5 h-5 shrink-0 text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
              {!isCollapsed && (
                <>
                  <span className="truncate whitespace-nowrap">Install Extension</span>
                  <ArrowUpRight className="w-4 h-4 ml-auto shrink-0 transition-colors text-slate-300 dark:text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-400" />
                </>
              )}
            </a>
          )}

          <a
            href="https://help.sqemes.com/"
            target="_blank"
            rel="noopener noreferrer"
            onMouseEnter={(e) => showTooltip(e, 'Documentation')}
            onMouseLeave={hideTooltip}
            className={`flex items-center gap-3 ${isCollapsed ? 'justify-center px-2' : 'px-3'} py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100`}
          >
            <BookOpen className="w-5 h-5 shrink-0 text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
            {!isCollapsed && (
              <>
                <span className="truncate">Documentation</span>
                <ArrowUpRight className="w-4 h-4 ml-auto shrink-0 transition-colors text-slate-300 dark:text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-400" />
              </>
            )}
          </a>

          {renderNavItem('/settings', Settings, 'Settings')}

          <div
            onClick={() => {
              navigate('/settings', { state: { initialTab: 'profile' } });
              closeMobileMenu();
            }}
            onMouseEnter={(e) => showTooltip(e, currentUser.name)}
            onMouseLeave={hideTooltip}
            className={`mt-2 flex items-center ${isCollapsed ? 'justify-center p-2' : 'gap-3 px-3 py-3'} rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 cursor-pointer hover:bg-white dark:hover:bg-slate-700 hover:shadow-soft transition-all group`}
          >
            <img src={currentUser.avatar} alt={currentUser.name} className="w-8 h-8 rounded-full object-cover ring-2 ring-white dark:ring-slate-700 shrink-0" />
            {!isCollapsed && (
              <div className="overflow-hidden flex-1">
                <div className="flex items-center gap-2">
                   <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{currentUser.name}</p>
                   <span className="text-2xs font-bold uppercase tracking-wider px-1.5 py-0.5 bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 rounded border border-slate-300 dark:border-slate-500">
                     {currentUser.role}
                   </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">Manage Profile</p>
              </div>
            )}
          </div>

          {isCollapsed ? (
            <button
              onClick={toggleTheme}
              onMouseEnter={(e) => showTooltip(e, theme === 'dark' ? 'Light Mode' : 'Dark Mode')}
              onMouseLeave={hideTooltip}
              className="w-full flex justify-center px-2 py-2.5 rounded-xl text-sm font-medium transition-all text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5 shrink-0" /> : <Moon className="w-5 h-5 shrink-0" />}
            </button>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2">
              <Sun className="w-4 h-4 shrink-0 text-amber-400" />
              <button
                onClick={toggleTheme}
                aria-label="Toggle dark mode"
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 focus:outline-none ${theme === 'dark' ? 'bg-brand-600' : 'bg-slate-300'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${theme === 'dark' ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
              </button>
              <Moon className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 ml-1 whitespace-nowrap">
                {theme === 'dark' ? 'Dark mode' : 'Light mode'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Tooltip */}
      {isCollapsed && tooltip && !mobileOpen && (
        <div 
          className="fixed left-20 ml-4 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg shadow-xl z-[100] animate-fade-in whitespace-nowrap pointer-events-none"
          style={{ top: tooltip.top, transform: 'translateY(-50%)' }}
        >
          {tooltip.label}
          {/* Little arrow */}
          <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-slate-900 rotate-45"></div>
        </div>
      )}

      {/* Create Workspace Modal — self-host disables adding workspaces (SQEM-121) */}
      {!IS_SELF_HOSTED && isWorkspaceModalOpen && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm border border-slate-100 dark:border-slate-700 animate-scale-up">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4">Create Workspace</h3>
            <form onSubmit={handleCreateWorkspace} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Workspace Name</label>
                <input
                  autoFocus
                  className={`w-full p-2.5 bg-white dark:bg-slate-700 border rounded-xl text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-500 ${workspaceNameError ? 'border-red-400' : 'border-slate-200 dark:border-slate-600'}`}
                  placeholder="e.g. My New Team"
                  value={newWorkspaceName}
                  onChange={e => { setNewWorkspaceName(e.target.value); if (workspaceNameError) setWorkspaceNameError(''); }}
                />
                {workspaceNameError && <p className="text-xs text-red-500 dark:text-red-400 mt-1">{workspaceNameError}</p>}
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                You will start on the <span className="font-bold text-slate-600 dark:text-slate-300">Solo</span> plan.
              </p>
              <div className="flex gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => { setIsWorkspaceModalOpen(false); setWorkspaceNameError(''); }}
                  className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 text-white bg-brand-600 rounded-xl hover:bg-brand-700 text-xs font-bold shadow-lg hover:shadow-brand-200 dark:shadow-none dark:hover:shadow-none transition-all"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default memo(Sidebar);
