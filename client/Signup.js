const handleSignup = async (e) => {
  e.preventDefault();
  try {
    const res = await fetch("http://localhost:5000/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (res.ok) {
      setMessage(data.message);
    } else {
      setMessage(data.message);
    }
  } catch (err) {
    setMessage("Server error. Please try again later.");
  }
};