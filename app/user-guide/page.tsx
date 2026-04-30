import Link from "next/link";

const siteUrl = "https://vehicle-borrow.vercel.app/";

export default function UserGuidePage() {
  return (
    <main className="guidePage">
      <Link aria-label="Back to dashboard" className="guideBackButton" href="/dashboard">
        Back
      </Link>

      <article className="guidePanel">
        <header className="guideHero">
          <p className="eyebrow">Vehicle Borrow</p>
          <h1>User Guide</h1>
          <p className="heroLead">
            Save the link for future use:{" "}
            <a href={siteUrl} rel="noreferrer" target="_blank">
              {siteUrl}
            </a>
          </p>
        </header>

        <section className="guideSection" id="quick-decision-guide">
          <h2>Quick Decision Guide</h2>
          <p>Not sure what to do? Use this quick guide:</p>
          <ul>
            <li>Already collected the key -&gt; Borrow</li>
            <li>Haven&apos;t collected the key yet -&gt; Book</li>
            <li>Finished using the vehicle -&gt; Return</li>
          </ul>
        </section>

        <section className="guideSection" id="important-first">
          <h2>Important First</h2>
          <p>Please follow these rules every time:</p>
          <ul>
            <li>Once you collect the vehicle key, you must record a Borrow immediately, within a few minutes.</li>
            <li>Booking alone is not enough.</li>
            <li>Create a Booking as early as possible if you know you&apos;ll need a vehicle.</li>
            <li>Always enter a clear purpose when booking.</li>
          </ul>
          <p>This helps avoid conflicts and keeps vehicle usage transparent across the team.</p>
        </section>

        <section className="guideSection" id="typical-usage-flow">
          <h2>Typical Usage Flow</h2>
          <p>Book (Optional) -&gt; Collect Key -&gt; Borrow -&gt; Use Vehicle -&gt; Return</p>
        </section>

        <section className="guideSection" id="what-the-system-does">
          <h2>What the system does</h2>
          <ul>
            <li>Borrow: when you are using a vehicle.</li>
            <li>Return: when you finish using a vehicle.</li>
            <li>Book: reserve a vehicle in advance.</li>
          </ul>
        </section>

        <section className="guideSection" id="login">
          <h2>Login</h2>
          <p>Use your company email to register and sign in.</p>
        </section>

        <section className="guideSection" id="borrow">
          <h2>Borrow</h2>
          <h3>Use when</h3>
          <ul>
            <li>You have collected the vehicle key.</li>
            <li>The vehicle is now being used.</li>
          </ul>
          <h3>Steps</h3>
          <ol>
            <li>Open the Borrow page.</li>
            <li>Select the vehicle.</li>
            <li>Enter details, including purpose and expected return time.</li>
            <li>Submit.</li>
          </ol>
          <h3>Important</h3>
          <ul>
            <li>Record Borrow immediately after collecting the key.</li>
            <li>Delays may cause booking conflicts or tracking issues.</li>
          </ul>
          <h3>Extend</h3>
          <p>If you need more time, use Extend on the Borrow page. Choose a later expected return time and enter a clear reason.</p>
          <p>If the new time conflicts with the next booking, the extension will fail. Choose an earlier time or contact the team.</p>
          <h3>If blocked</h3>
          <p>This usually means the vehicle is already booked, or your time overlaps with an existing booking.</p>
          <p>Choose another vehicle or time.</p>
        </section>

        <section className="guideSection" id="return">
          <h2>Return</h2>
          <h3>Use when</h3>
          <ul>
            <li>Vehicle use has finished.</li>
            <li>The key has been returned.</li>
          </ul>
          <h3>Steps</h3>
          <ol>
            <li>Open the Return page.</li>
            <li>Select the vehicle.</li>
            <li>Submit return.</li>
          </ol>
          <h3>Important</h3>
          <p>You must complete Return after use. Otherwise, the vehicle will remain unavailable to others.</p>
        </section>

        <section className="guideSection" id="book">
          <h2>Book</h2>
          <h3>Use when</h3>
          <ul>
            <li>You want to reserve a vehicle in advance.</li>
          </ul>
          <h3>Steps</h3>
          <ol>
            <li>Open the Book page.</li>
            <li>Select the vehicle.</li>
            <li>Enter start and end time.</li>
            <li>Enter a clear purpose.</li>
            <li>Submit.</li>
          </ol>
          <h3>Important</h3>
          <ul>
            <li>Booking is only a reservation.</li>
            <li>You must still complete Borrow when you collect the key.</li>
          </ul>
          <h3>Key collected</h3>
          <p>If you already have a booking and have collected the key, select Key collected on your booking. The system will convert the booking into an active borrow.</p>
          <h3>If blocked</h3>
          <p>This usually means the vehicle is already booked, or your selected time overlaps.</p>
          <p>Choose another vehicle or adjust the time.</p>
        </section>

        <section className="guideSection" id="manage-your-bookings">
          <h2>Manage your bookings</h2>
          <p>Go to the homepage -&gt; My Bookings.</p>
          <p>You can edit details, change time, or cancel bookings.</p>
        </section>

        <section className="guideSection" id="booking-rules">
          <h2>Booking Rules</h2>
          <ul>
            <li>No overlapping bookings.</li>
            <li>Cannot borrow during another booking.</li>
            <li>Cannot book during an active borrow.</li>
          </ul>
        </section>

        <section className="guideSection" id="common-mistakes-to-avoid">
          <h2>Common Mistakes to Avoid</h2>
          <ul>
            <li>Booking only, without Borrow.</li>
            <li>Using a vehicle without Borrow.</li>
            <li>Forgetting to Return.</li>
            <li>Entering unclear purpose.</li>
            <li>Incorrect time selection.</li>
          </ul>
          <p>These may cause conflicts or make vehicles unavailable to others.</p>
        </section>
      </article>
    </main>
  );
}
