"use client";

import React from "react";

export function DocSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-2xl font-bold text-gray-100 mb-4 pb-2 border-b border-gray-800">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-lg font-semibold text-gray-200 mt-6 mb-2">{children}</h3>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-400 leading-relaxed">{children}</p>;
}

export function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc list-inside space-y-1 text-sm text-gray-400">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function NumberedList({ items }: { items: string[] }) {
  return (
    <ol className="list-decimal list-inside space-y-1 text-sm text-gray-400">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
}

export function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border border-gray-800 rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-gray-900">
            {headers.map((h, i) => (
              <th key={i} className="px-4 py-2 text-left font-semibold text-gray-300 border-b border-gray-800">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-gray-950" : "bg-gray-900/50"}>
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2 text-gray-400 border-b border-gray-800/50">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Steps({ items }: { items: { label: string; desc: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30">
            <span className="text-sm font-semibold text-violet-300">{item.label}</span>
          </div>
          <span className="text-xs text-gray-500 max-w-48">{item.desc}</span>
          {i < items.length - 1 && (
            <svg className="w-4 h-4 text-gray-700" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

export function InfoBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-violet-950/30 border border-violet-500/20 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-4 h-4 text-violet-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
        <span className="text-sm font-semibold text-violet-300">{title}</span>
      </div>
      <div className="text-sm text-gray-400">{children}</div>
    </div>
  );
}

export function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-950/30 border border-amber-500/20 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-1">
        <svg className="w-4 h-4 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
        <span className="text-sm font-semibold text-amber-300">Warning</span>
      </div>
      <div className="text-sm text-gray-400">{children}</div>
    </div>
  );
}

export function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-violet-600/30 text-violet-300 border border-violet-500/30">
      {children}
    </span>
  );
}
