import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './AppShell'
import Landing from '../pages/Landing'
import Funding from '../pages/Funding'
import Procurement from '../pages/Procurement'
import Companies from '../pages/Companies'
import Organizations from '../pages/Organizations'
import Sources from '../pages/Sources'
import OpportunityDetail from '../pages/OpportunityDetail'
import CompanyDetail from '../pages/CompanyDetail'
import Matches from '../pages/Matches'
import MatchDetail from '../pages/MatchDetail'
import Applications from '../pages/Applications'
import ApplicationDetail from '../pages/ApplicationDetail'
import OrganizationDetail from '../pages/OrganizationDetail'
import SourceDetail from '../pages/SourceDetail'
import NoticeDetail from '../pages/NoticeDetail'
import Bids from '../pages/Bids'
import BidDetail from '../pages/BidDetail'
import Contracts from '../pages/Contracts'
import ContractDetail from '../pages/ContractDetail'
import Review from '../pages/Review'
import ReviewDetail from '../pages/ReviewDetail'
import Discovery from '../pages/Discovery'
import MatchReview from '../pages/MatchReview'
import MatchReviewDetail from '../pages/MatchReviewDetail'
import ProcurementMatchReview from '../pages/ProcurementMatchReview'
import ProcurementMatchReviewDetail from '../pages/ProcurementMatchReviewDetail'
import NotFound from '../pages/NotFound'

/**
 * Route table.
 *
 * The landing route is standalone and sits outside the shell, so it has no
 * navigation chrome. Every other route shares one pathless layout route, so the
 * top navigation mounts once and persists across navigation.
 *
 * `/dashboard` is gone: Home (`/`) is the product entry point, and the
 * obsolete address redirects there rather than dead-ending on the catch-all.
 *
 * Funding and Procurement each own two addresses: the hub (`/funding`,
 * `/procurement`) and the collection's historical path (`/opportunities`,
 * `/notices`), because record links and workspace drill-downs still resolve
 * through `pathForRecord`. Both render the same hub component.
 */
export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/dashboard" element={<Navigate to="/" replace />} />

      <Route element={<AppShell />}>
        <Route path="/funding" element={<Funding />} />
        <Route path="/opportunities" element={<Funding />} />
        <Route path="/opportunities/:id" element={<OpportunityDetail />} />

        <Route path="/procurement" element={<Procurement />} />
        <Route path="/notices" element={<Procurement />} />
        <Route path="/notices/:id" element={<NoticeDetail />} />

        <Route path="/companies" element={<Companies />} />
        <Route path="/companies/:id" element={<CompanyDetail />} />

        <Route path="/organizations" element={<Organizations />} />
        <Route path="/organizations/:id" element={<OrganizationDetail />} />

        <Route path="/sources" element={<Sources />} />
        <Route path="/sources/:id" element={<SourceDetail />} />

        <Route path="/matches" element={<Matches />} />
        <Route path="/matches/:id" element={<MatchDetail />} />

        <Route path="/applications" element={<Applications />} />
        <Route path="/applications/:id" element={<ApplicationDetail />} />

        <Route path="/bids" element={<Bids />} />
        <Route path="/bids/:id" element={<BidDetail />} />

        <Route path="/contracts" element={<Contracts />} />
        <Route path="/contracts/:id" element={<ContractDetail />} />

        <Route path="/review" element={<Review />} />
        <Route path="/review/:reviewId" element={<ReviewDetail />} />

        <Route path="/discovery" element={<Discovery />} />

        <Route path="/match-review" element={<MatchReview />} />
        <Route path="/match-review/:proposalId" element={<MatchReviewDetail />} />

        <Route path="/procurement-match-review" element={<ProcurementMatchReview />} />
        <Route path="/procurement-match-review/:proposalId" element={<ProcurementMatchReviewDetail />} />

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
