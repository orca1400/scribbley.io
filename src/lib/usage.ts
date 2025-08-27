import { supabase } from './supabase';
import { getOrCreateSession, markGuestFreebieConsumed } from './session';
import { DateTime } from 'luxon';

export interface UsageEvent {
  id: string;
  user_id: string | null;
  session_id: string;
  feature: string;
  words: number;
  tokens: number;
  billable: boolean;
  reason: string;
  created_at: string;
}

export interface RecordUsageParams {
  sessionId?: string;
  userId?: string | null;
  feature: string;
  words: number;
  tokens: number;
}

/**
 * Record usage event with automatic billability determination
 */
export async function recordUsage(params: RecordUsageParams): Promise<UsageEvent> {
  try {
    const { sessionId: providedSessionId, userId, feature, words, tokens } = params;
    
    // Get or create session if not provided
    let sessionId = providedSessionId;
    let session;
    
    if (!sessionId) {
      session = await getOrCreateSession();
      sessionId = session.id;
    } else {
      // Fetch session details
      const { data: sessionData, error: sessionError } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .single();
      
      if (sessionError) {
        console.error('Error fetching session:', sessionError);
        throw sessionError;
      }
      
      session = sessionData;
    }

    // Determine billability
    let billable = true;
    let reason = 'regular';

    // Check for guest freebie eligibility
    if (session.is_guest && 
        feature === 'book_5_chapters' && 
        !session.has_consumed_guest_freebie) {
      billable = false;
      reason = 'guest_free_book';
      
      // Mark freebie as consumed
      await markGuestFreebieConsumed(sessionId);
    }

    // Create usage event
    const { data: usageEvent, error: createError } = await supabase
      .from('usage_events')
      .insert({
        user_id: userId || session.user_id,
        session_id: sessionId,
        feature,
        words,
        tokens,
        billable,
        reason
      })
      .select()
      .single();

    if (createError) {
      console.error('Error creating usage event:', createError);
      throw createError;
    }

    console.log(`Usage recorded: ${feature}, ${words} words, billable: ${billable}, reason: ${reason}`);
    
    return usageEvent;
  } catch (error) {
    console.error('Error in recordUsage:', error);
    throw error;
  }
}

/**
 * Get current month date range in Europe/Vienna timezone
 */
export function currentMonthViennaRange() {
  const nowVIE = DateTime.now().setZone('Europe/Vienna');
  const start = nowVIE.startOf('month').toISO();
  const end = nowVIE.endOf('month').toISO();
  return { fromISO: start!, toISO: end! };
}

/**
 * Get billable word usage for a user in the current month (Europe/Vienna timezone)
 */
export async function getBillableWordsThisMonth(userId: string): Promise<number> {
  try {
    const { fromISO, toISO } = currentMonthViennaRange();

    const { data, error } = await supabase
      .from('usage_events')
      .select('words')
      .eq('user_id', userId)
      .eq('billable', true)
      .gte('created_at', fromISO)
      .lte('created_at', toISO);

    if (error) {
      console.error('Error fetching billable words:', error);
      throw error;
    }

    const totalWords = data?.reduce((sum, event) => sum + (event.words || 0), 0) || 0;
    return totalWords;
  } catch (error) {
    console.error('Error in getBillableWordsThisMonth:', error);
    throw error;
  }
}

/**
 * Get free word usage for a user in the current month
 */
export async function getFreeWordsThisMonth(userId: string): Promise<number> {
  try {
    const { fromISO, toISO } = currentMonthViennaRange();

    const { data, error } = await supabase
      .from('usage_events')
      .select('words')
      .eq('user_id', userId)
      .eq('billable', false)
      .gte('created_at', fromISO)
      .lte('created_at', toISO);

    if (error) {
      console.error('Error fetching free words:', error);
      throw error;
    }

    const totalWords = data?.reduce((sum, event) => sum + (event.words || 0), 0) || 0;
    return totalWords;
  } catch (error) {
    console.error('Error in getFreeWordsThisMonth:', error);
    throw error;
  }
}

/**
 * Get usage summary for a user
 */
export async function getUsageSummary(userId: string): Promise<{
  billableWords: number;
  freeWords: number;
  totalWords: number;
  totalEvents: number;
}> {
  try {
    const [billableWords, freeWords] = await Promise.all([
      getBillableWordsThisMonth(userId),
      getFreeWordsThisMonth(userId)
    ]);

    return {
      billableWords,
      freeWords,
      totalWords: billableWords + freeWords,
      totalEvents: 0 // TODO: Add if needed
    };
  } catch (error) {
    console.error('Error in getUsageSummary:', error);
    throw error;
  }
}