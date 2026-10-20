import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './AppShell'
import Companies from '../pages/Companies'
import CompanyDetail from '../pages/CompanyDetail'
import ReviewDetailView from '../components/review/ReviewDetail'
import Discovery from '../pages/Discovery'
import HistoryRunDetail from '../pages/HistoryRunDetail'

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/discovery" replace />} />
        <Route path="/dashboard" element={<Navigate to="/discovery" replace />} />
        <Route path="/companies" element={<Companies />} />
        <Route path="/companies/:id" element={<CompanyDetail />} />
        <Route path="/discovery" element={<Discovery />} />
        <Route path="/discovery/review/:reviewId" element={<ReviewDetailView />} />
        <Route path="/discovery/history/:runId" element={<HistoryRunDetail />} />
        <Route path="*" element={<Navigate to="/discovery" replace />} />
      </Route>
    </Routes>
  )
}
