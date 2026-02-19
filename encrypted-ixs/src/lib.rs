use arcis::*;

#[encrypted]
pub mod confidential_vote {
    use arcis::*;

    const MAX_OPTIONS: usize = 8;

    pub struct VoteInput {
        pub option: u8,
    }

    pub struct TallyState {
        pub c0: u64,
        pub c1: u64,
        pub c2: u64,
        pub c3: u64,
        pub c4: u64,
        pub c5: u64,
        pub c6: u64,
        pub c7: u64,
    }

    #[instruction]
    pub fn init_tally(tally_ctxt: Enc<Shared, TallyState>) -> Enc<Mxe, TallyState> {
        let tally = tally_ctxt.to_arcis();
        Mxe::get().from_arcis(tally)
    }

    #[instruction]
    pub fn apply_vote(
        vote_ctxt: Enc<Shared, VoteInput>,
        tally_ctxt: Enc<Mxe, TallyState>,
    ) -> Enc<Mxe, TallyState> {
        let vote = vote_ctxt.to_arcis();
        let mut tally = tally_ctxt.to_arcis();

        let idx = vote.option as usize;
        if idx == 0 {
            tally.c0 = tally.c0 + 1u64;
        } else if idx == 1 {
            tally.c1 = tally.c1 + 1u64;
        } else if idx == 2 {
            tally.c2 = tally.c2 + 1u64;
        } else if idx == 3 {
            tally.c3 = tally.c3 + 1u64;
        } else if idx == 4 {
            tally.c4 = tally.c4 + 1u64;
        } else if idx == 5 {
            tally.c5 = tally.c5 + 1u64;
        } else if idx == 6 {
            tally.c6 = tally.c6 + 1u64;
        } else if idx == 7 {
            tally.c7 = tally.c7 + 1u64;
        }

        tally_ctxt.owner.from_arcis(tally)
    }

    #[instruction]
    pub fn reveal_tally(tally_ctxt: Enc<Mxe, TallyState>) -> [u64; MAX_OPTIONS] {
        let tally = tally_ctxt.to_arcis();
        [
            tally.c0.reveal(),
            tally.c1.reveal(),
            tally.c2.reveal(),
            tally.c3.reveal(),
            tally.c4.reveal(),
            tally.c5.reveal(),
            tally.c6.reveal(),
            tally.c7.reveal(),
        ]
    }
}
