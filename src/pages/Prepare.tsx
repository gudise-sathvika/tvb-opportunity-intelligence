/**
 * Phase 33 preparation workspace route: `/prepare/:reviewId`.
 *
 * Thin route shell over `PreparationWorkspaceView`. The workspace loads from
 * the local review store plus browser-local working state; opening this page
 * performs no source requests and changes no review decisions.
 */

import { useParams } from 'react-router-dom'
import PreparationWorkspaceView from '../components/review/PreparationWorkspaceView'

export default function Prepare() {
  const { reviewId } = useParams<{ reviewId: string }>()
  return <PreparationWorkspaceView reviewId={reviewId ?? ''} />
}
