import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './AppShell'
import Companies from '../pages/Companies'
import CompanyDetail from '../pages/CompanyDetail'
import ReviewDetailView from '../components/review/ReviewDetail'
import Discovery from '../pages/Discovery'
import History from '../pages/History'
import HistoryRunDetail from '../pages/HistoryRunDetail'
import Logs from '../pages/Logs'
import Review from '../pages/Review'
import Prepare from '../pages/Prepare'

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/discovery" replace />} />
        <Route path="/overview" element={<Navigate to="/discovery" replace />} />
        <Route path="/dashboard" element={<Navigate to="/discovery" replace />} />
        <Route path="/funding" element={<Navigate to="/discovery" replace />} />
        <Route path="/procurement" element={<Navigate to="/discovery" replace />} />
        <Route path="/review/funding" element={<Navigate to="/discovery" replace />} />
        <Route path="/review/procurement" element={<Navigate to="/discovery" replace />} />
        <Route path="/companies" element={<Companies />} />
        <Route path="/companies/:id" element={<CompanyDetail />} />
        <Route path="/discovery" element={<Discovery />} />
        <Route path="/review" element={<Review />} />
        <Route path="/discovery/review/:reviewId" element={<ReviewDetailView />} />
        <Route path="/review/:reviewId" element={<ReviewDetailView />} />
        <Route path="/prepare/:reviewId" element={<Prepare />} />
        <Route path="/history" element={<History />} />
        <Route path="/history/:runId" element={<HistoryRunDetail />} />
        <Route path="/discovery/history/:runId" element={<HistoryRunDetail />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="*" element={<Navigate to="/discovery" replace />} />
      </Route>
    </Routes>
  )
}

