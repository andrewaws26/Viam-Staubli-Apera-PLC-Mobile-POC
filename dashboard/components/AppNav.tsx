"use client";

/**
 * AppNav — Shared top navigation bar for all IronSight OS pages.
 *
 * Slim, persistent bar with logo, breadcrumb, and user controls.
 * Replaces the 17-link header that was crammed into Dashboard.tsx.
 */

import { useUser, SignOutButton } from "@clerk/nextjs";
import { useState } from "react";

interface Props {
  /** Optional page title shown as breadcrumb after "IronSight" */
  pageTitle?: string;
}

export default function AppNav({ pageTitle }: Props) {
  const { user } = useUser();
  const [menuOpen, setMenuOpen] = useState(false);

  const role =
    ((user?.publicMetadata as Record<string, unknown>)?.role as string) || "operator";
  const isAdmin = role === "developer" || role === "manager";
  const firstName = user?.firstName || "User";

  return (
    <nav className="border-b border-gray-800/80 bg-gray-950/95 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
        {/* Left: Logo + breadcrumb */}
        <div className="flex items-center gap-3 min-w-0">
          <a href="/" className="flex items-center gap-2.5 shrink-0 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center shadow-lg shadow-violet-900/30 group-hover:shadow-violet-800/50 transition-shadow">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4.5 h-4.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="text-sm font-black tracking-widest uppercase text-gray-200 group-hover:text-white transition-colors hidden sm:block">
              IronSight
            </span>
          </a>
          {pageTitle && (
            <>
              <span className="text-gray-700 hidden sm:block">/</span>
              <span className="text-sm font-semibold text-gray-400 truncate hidden sm:block">
                {pageTitle}
              </span>
            </>
          )}
        </div>

        {/* Right: Quick links + user */}
        <div className="flex items-center gap-2">
          {/* Desktop quick links */}
          <div className="hidden md:flex items-center gap-1">
            <NavLink href="/" label="Home" />
            <NavLink href="/fleet" label="Fleet" />
            <NavLink href="/work" label="Work" />
            <NavLink href="/chat" label="Chat" />
            <NavLink href="/timesheets" label="Time" />
            {isAdmin && <NavLink href="/accounting" label="Finance" />}
            {isAdmin && <NavLink href="/accounting/invoices" label="Invoices" />}
            {isAdmin && <NavLink href="/accounting/bills" label="Bills" />}
            {isAdmin && <NavLink href="/accounting/customers" label="Clients" />}
            {isAdmin && <NavLink href="/accounting/bank" label="Bank" />}
            {isAdmin && <NavLink href="/accounting/recurring" label="Recurring" />}
            {isAdmin && <NavLink href="/accounting/periods" label="Periods" />}
            {isAdmin && <NavLink href="/accounting/payroll-run" label="Payroll" />}
            {isAdmin && <NavLink href="/accounting/budget" label="Budget" />}
            {isAdmin && <NavLink href="/accounting/reports" label="Reports" />}
          </div>

          {/* User menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-800/60 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white">
                {firstName[0]}
              </div>
              <span className="text-xs font-semibold text-gray-400 hidden sm:block">
                {firstName}
              </span>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-gray-600" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-56 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl shadow-black/50 z-50 py-1 overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-800">
                    <p className="text-sm font-semibold text-gray-200">{user?.fullName || firstName}</p>
                    <p className="text-xs text-gray-500">{role}</p>
                  </div>

                  {/* Mobile nav links */}
                  <div className="md:hidden border-b border-gray-800 py-1">
                    <MenuLink href="/" label="Home" />
                    <MenuLink href="/fleet" label="Fleet Overview" />
                    <MenuLink href="/work" label="Work Orders" />
                    <MenuLink href="/chat" label="Team Chat" />
                    <MenuLink href="/timesheets" label="Timesheets" />
                    <MenuLink href="/pto" label="Time Off" />
                    <MenuLink href="/training" label="Training" />
                    {isAdmin && <MenuLink href="/accounting" label="Accounting" />}
                    {isAdmin && <MenuLink href="/accounting/invoices" label="Invoices (AR)" />}
                    {isAdmin && <MenuLink href="/accounting/bills" label="Bills (AP)" />}
                    {isAdmin && <MenuLink href="/accounting/customers" label="Customers & Vendors" />}
                    {isAdmin && <MenuLink href="/accounting/bank" label="Bank Reconciliation" />}
                    {isAdmin && <MenuLink href="/accounting/recurring" label="Recurring Entries" />}
                    {isAdmin && <MenuLink href="/accounting/periods" label="Accounting Periods" />}
                    {isAdmin && <MenuLink href="/accounting/employee-tax" label="Employee Payroll Setup" />}
                    {isAdmin && <MenuLink href="/accounting/payroll-run" label="Run Payroll" />}
                    {isAdmin && <MenuLink href="/accounting/vendor-1099" label="1099 Tracking" />}
                    {isAdmin && <MenuLink href="/accounting/budget" label="Budget vs. Actual" />}
                    {isAdmin && <MenuLink href="/accounting/reports" label="Financial Reports" />}
                    {isAdmin && <MenuLink href="/inventory" label="Inventory" />}
                    {isAdmin && <MenuLink href="/payroll" label="Payroll Export" />}
                  </div>

                  <MenuLink href="/profile" label="My Profile" />
                  {isAdmin && <MenuLink href="/admin" label="Admin" />}
                  <div className="border-t border-gray-800 mt-1 pt-1">
                    <SignOutButton>
                      <button className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-gray-800/60 transition-colors">
                        Sign Out
                      </button>
                    </SignOutButton>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2 rounded-lg hover:bg-gray-800/60 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    </nav>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="px-2.5 py-1.5 rounded-md text-xs font-semibold text-gray-500 hover:text-gray-200 hover:bg-gray-800/50 transition-colors"
    >
      {label}
    </a>
  );
}

function MenuLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="block px-3 py-2 text-sm text-gray-300 hover:bg-gray-800/60 hover:text-white transition-colors"
    >
      {label}
    </a>
  );
}
