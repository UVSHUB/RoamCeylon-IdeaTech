import Link from "next/link";
import { 
  ArrowLeft, 
  Search, 
  Bell, 
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Download
} from 'lucide-react';

// Static Data for the mock
const alertLogs = [
  { id: 1, time: "Oct 24 , 14.32.01", severity: "Critical", metric: "System Error exceed threshold", status: "Unresolved", action: "Details" },
  { id: 2, time: "Oct 24 , 14.15.01", severity: "Warning", metric: "Response time increased", status: "Investigating", action: "Details" },
  { id: 3, time: "Oct 24 , 13.45.21", severity: "Critical", metric: "System Error exceed threshold", status: "", action: "Details" },
  { id: 4, time: "Oct 23 , 11.45.11", severity: "Warning", metric: "Response time increased", status: "", action: "Details" },
  { id: 5, time: "Oct 22 , 13.45.21", severity: "Resolved", metric: "Positive Feedback restored", status: "Fixed", action: "View History" },
  { id: 6, time: "Oct 22 , 13.45.21", severity: "Resolved", metric: "System errors back to normal", status: "Fixed", action: "View History" },
  { id: 7, time: "Oct 18 , 13.45.21", severity: "Warning", metric: "Response time increased", status: "Investigating", action: "Details" },
  { id: 8, time: "Oct 18 , 13.45.21", severity: "Resolved", metric: "System errors back to normal", status: "Fixed", action: "View History" },
];

export default function AlertsPage() {
  return (
    <div className="space-y-6">
      {/* Header Area */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight">Alert History & Management</h2>
        
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input 
              type="text" 
              placeholder="Search" 
              className="pl-9 pr-4 py-2 bg-zinc-100 dark:bg-zinc-900 border-none rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:focus:ring-zinc-800 w-64"
            />
          </div>
          <button className="relative p-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full"></span>
          </button>
        </div>
      </div>

      <div className="mb-6">
        <Link 
          href="/admin/analytics" 
          className="inline-flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Critical */}
        <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/50 rounded-xl p-6 relative overflow-hidden flex flex-col justify-between min-h-[140px]">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-rose-500 text-white rounded-lg">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-rose-800 dark:text-rose-400">Critical Alert</h3>
            </div>
          </div>
          <div className="absolute bottom-4 right-4">
            <span className="px-2 py-1 bg-white/50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400 text-xs font-bold tracking-wider rounded uppercase">
              Active
            </span>
          </div>
        </div>

        {/* Warning */}
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/50 rounded-xl p-6 relative overflow-hidden flex flex-col justify-between min-h-[140px]">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-amber-500 text-white rounded-lg">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-amber-800 dark:text-amber-400">Warning Notification</h3>
              <p className="text-sm text-amber-700/80 dark:text-amber-500/80 mt-1">Unusual spike in login attempts from new IP range.</p>
            </div>
          </div>
          <div className="absolute bottom-4 right-4">
            <span className="px-2 py-1 bg-white/50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 text-xs font-bold tracking-wider rounded uppercase">
              Pending
            </span>
          </div>
        </div>

        {/* Operational */}
        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50 rounded-xl p-6 relative overflow-hidden flex flex-col justify-between min-h-[140px]">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-emerald-500 text-white rounded-lg">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-emerald-800 dark:text-emerald-400">Healthy Status</h3>
              <p className="text-sm text-emerald-700/80 dark:text-emerald-500/80 mt-1">Database sync and API health within normal parameters.</p>
            </div>
          </div>
          <div className="absolute bottom-4 right-4">
            <span className="px-2 py-1 bg-white/50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 text-xs font-bold tracking-wider rounded uppercase">
              Operational
            </span>
          </div>
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white dark:bg-zinc-950 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden mt-8">
        <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <h3 className="font-semibold text-lg">Recent Alert Logs</h3>
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
              <Download className="w-4 h-4" />
              Export CSV
            </button>
            <button className="px-4 py-1.5 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 dark:bg-teal-700 dark:hover:bg-teal-600 rounded-lg transition-colors">
              Filter Results
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-zinc-50 dark:bg-zinc-900/50 text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="font-medium p-4 py-3 rounded-tl-lg">Time</th>
                <th className="font-medium p-4 py-3">Severity</th>
                <th className="font-medium p-4 py-3">Metric Triggered</th>
                <th className="font-medium p-4 py-3">Status</th>
                <th className="font-medium p-4 py-3 rounded-tr-lg">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
              {alertLogs.map((log) => (
                <tr key={log.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20 transition-colors">
                  <td className="p-4 text-sm whitespace-nowrap">{log.time}</td>
                  <td className="p-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                      ${log.severity === 'Critical' ? 'bg-rose-500 text-white' : 
                        log.severity === 'Warning' ? 'bg-amber-500 text-white' : 
                        'bg-emerald-500 text-white'}`}
                    >
                      {log.severity === 'Critical' && <AlertCircle className="w-3 h-3" />}
                      {log.severity === 'Warning' && <AlertTriangle className="w-3 h-3" />}
                      {log.severity === 'Resolved' && <CheckCircle2 className="w-3 h-3" />}
                      {log.severity}
                    </span>
                  </td>
                  <td className="p-4 text-sm text-zinc-600 dark:text-zinc-300">{log.metric}</td>
                  <td className="p-4">
                    {log.status && (
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium
                        ${log.status === 'Unresolved' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400' :
                        log.status === 'Investigating' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400' :
                        'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'}`}
                      >
                        {log.status}
                      </span>
                    )}
                  </td>
                  <td className="p-4">
                    <button className="text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 text-sm font-medium transition-colors">
                      {log.action}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
